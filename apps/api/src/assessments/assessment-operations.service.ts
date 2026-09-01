import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { AuthContextService } from "../auth/auth-context.service";
import { CandidateSessionService } from "../auth/candidate-session.service";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import type { AssessmentSubmissionRequestDto } from "./assessments.dto";
import type { QueueAssessmentExecutionDto, ReviewAssessmentDto } from "./assessment-operations.dto";

function reviewerId(auth: AuthContextService): string {
  const id = auth.getOptional()?.userId;
  if (!id) throw new UnauthorizedException("Authenticated reviewer is required");
  return id;
}

@Injectable()
export class AssessmentOperationsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
    private readonly authContext: AuthContextService,
    private readonly candidateSessions: CandidateSessionService,
  ) {}

  private async candidateScope(rawToken: string | undefined) {
    const scope = await this.candidateSessions.resolve(rawToken);
    if (!scope) throw new UnauthorizedException("Candidate session is required");
    return scope;
  }

  async listCandidateAssessments(rawToken: string | undefined) {
    const scope = await this.candidateScope(rawToken);
    const rows = await this.database.sql`
      SELECT
        s.id::text AS session_id,
        s.status,
        s.started_at,
        s.submitted_at,
        s.expires_at,
        s.candidate_notice_version,
        s.review_state,
        a.id::text AS assessment_id,
        a.assessment_type,
        a.title,
        a.instructions,
        a.time_limit_minutes,
        a.version,
        j.title AS job_title,
        sub.id::text AS submission_id,
        result.id::text AS result_id,
        result.status AS result_status,
        result.normalized_score
      FROM assessment_sessions s
      JOIN assessments a
        ON a.organization_id = s.organization_id AND a.id = s.assessment_id
      JOIN applications app
        ON app.organization_id = s.organization_id AND app.id = s.application_id
      JOIN jobs j
        ON j.organization_id = app.organization_id AND j.id = app.job_id
      LEFT JOIN LATERAL (
        SELECT id FROM assessment_submissions x
        WHERE x.organization_id = s.organization_id AND x.assessment_session_id = s.id
        ORDER BY x.submitted_at DESC LIMIT 1
      ) sub ON true
      LEFT JOIN LATERAL (
        SELECT id, status, normalized_score FROM assessment_results r
        WHERE r.organization_id = s.organization_id AND r.assessment_session_id = s.id
        ORDER BY r.created_at DESC LIMIT 1
      ) result ON true
      WHERE s.organization_id = ${scope.organizationId}::uuid
        AND s.application_id = ${scope.applicationId}::uuid
      ORDER BY s.created_at DESC
    `;
    return {
      candidateId: scope.candidateId,
      applicationId: scope.applicationId,
      sessions: rows,
      integrityNotice:
        "Integrity signals are review aids only and never an automatic misconduct finding.",
    };
  }

  async startCandidateAssessment(rawToken: string | undefined, assessmentSessionId: string) {
    const scope = await this.candidateScope(rawToken);
    const rows = await this.database.sql`
      UPDATE assessment_sessions
      SET status = CASE WHEN status = 'invited' THEN 'in_progress' ELSE status END,
          started_at = COALESCE(started_at, now()),
          updated_at = now()
      WHERE organization_id = ${scope.organizationId}::uuid
        AND application_id = ${scope.applicationId}::uuid
        AND id = ${assessmentSessionId}::uuid
        AND status IN ('invited', 'in_progress')
        AND (expires_at IS NULL OR expires_at > now())
      RETURNING id::text, status, started_at, expires_at, candidate_notice_version
    `;
    if (!rows[0]) throw new NotFoundException("Available assessment session not found");
    return rows[0];
  }

  async submitCandidateAssessment(
    rawToken: string | undefined,
    assessmentSessionId: string,
    input: AssessmentSubmissionRequestDto,
  ) {
    const scope = await this.candidateScope(rawToken);
    const language = input.language?.trim();
    const sourceText = input.sourceText?.trim() || null;
    const artifactFileId = input.artifactFileId ?? null;
    if (!language) throw new BadRequestException("language is required");
    if (!sourceText && !artifactFileId) {
      throw new BadRequestException("sourceText or artifactFileId is required");
    }

    return this.database.sql.begin(async (tx) => {
      const sessions = await tx`
        SELECT id::text, status
        FROM assessment_sessions
        WHERE organization_id = ${scope.organizationId}::uuid
          AND application_id = ${scope.applicationId}::uuid
          AND id = ${assessmentSessionId}::uuid
          AND status = 'in_progress'
          AND (expires_at IS NULL OR expires_at > now())
        LIMIT 1
        FOR UPDATE
      `;
      if (!sessions[0]) throw new NotFoundException("In-progress assessment session not found");

      const existing = await tx`
        SELECT id::text
        FROM assessment_submissions
        WHERE organization_id = ${scope.organizationId}::uuid
          AND assessment_session_id = ${assessmentSessionId}::uuid
        LIMIT 1
      `;
      if (existing[0]) throw new BadRequestException("Assessment has already been submitted");

      const rows = await tx`
        INSERT INTO assessment_submissions (
          organization_id, assessment_session_id, language, source_text, artifact_file_id, submitted_at
        ) VALUES (
          ${scope.organizationId}::uuid,
          ${assessmentSessionId}::uuid,
          ${language},
          ${sourceText},
          ${artifactFileId}::uuid,
          now()
        )
        RETURNING id::text, assessment_session_id::text, language, submitted_at
      `;
      await tx`
        UPDATE assessment_sessions
        SET status = 'submitted', submitted_at = now(), updated_at = now()
        WHERE organization_id = ${scope.organizationId}::uuid AND id = ${assessmentSessionId}::uuid
      `;
      return {
        ...rows[0],
        executionBoundary: "isolated_assessment_runner_required",
        coreApiExecutedCode: false,
      };
    });
  }

  async queueExecution(submissionId: string, input: QueueAssessmentExecutionDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const submissions = await this.database.sql`
      SELECT
        sub.id::text,
        sub.language,
        s.id::text AS session_id,
        a.time_limit_minutes,
        a.runner_policy
      FROM assessment_submissions sub
      JOIN assessment_sessions s
        ON s.organization_id = sub.organization_id AND s.id = sub.assessment_session_id
      JOIN assessments a
        ON a.organization_id = s.organization_id AND a.id = s.assessment_id
      WHERE sub.organization_id = ${organizationId}::uuid AND sub.id = ${submissionId}::uuid
      LIMIT 1
    `;
    const submission = submissions[0];
    if (!submission) throw new NotFoundException("Assessment submission not found");
    const policy = submission.runner_policy && typeof submission.runner_policy === "object"
      ? (submission.runner_policy as Record<string, unknown>)
      : {};
    const policyMemory = typeof policy.memoryLimitMb === "number" ? policy.memoryLimitMb : 512;
    const timeLimitMs = input.timeLimitMs ?? Math.max(1000, Math.min(600000, Number(submission.time_limit_minutes ?? 10) * 60_000));
    const memoryLimitMb = input.memoryLimitMb ?? Math.max(64, Math.min(4096, policyMemory));
    const rows = await this.database.sql`
      INSERT INTO assessment_execution_jobs (
        organization_id, submission_id, state, requested_runner_type,
        time_limit_ms, memory_limit_mb, network_access
      ) VALUES (
        ${organizationId}::uuid,
        ${submissionId}::uuid,
        'queued',
        'isolated-worker',
        ${timeLimitMs},
        ${memoryLimitMb},
        false
      )
      ON CONFLICT (organization_id, submission_id) DO UPDATE
      SET updated_at = now()
      RETURNING id::text, submission_id::text, state, requested_runner_type,
                time_limit_ms, memory_limit_mb, network_access, attempt_count, created_at
    `;
    return {
      ...rows[0],
      sourceAccess: "submission_reference_only",
      coreApiExecution: "prohibited",
      workerRequirements: {
        isolatedProcess: true,
        networkAccess: false,
        resourceLimitsRequired: true,
      },
    };
  }

  async listExecutionJobs() {
    const organizationId = this.tenantContext.require().organizationId;
    return this.database.sql`
      SELECT id::text, submission_id::text, state, requested_runner_type,
             time_limit_ms, memory_limit_mb, network_access, attempt_count,
             external_job_reference, last_error, claimed_at, completed_at, created_at
      FROM assessment_execution_jobs
      WHERE organization_id = ${organizationId}::uuid
      ORDER BY created_at DESC
      LIMIT 200
    `;
  }

  async reviewAssessment(assessmentSessionId: string, input: ReviewAssessmentDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const reviewer = reviewerId(this.authContext);
    return this.database.sql.begin(async (tx) => {
      const sessions = await tx`
        SELECT
          s.id::text,
          s.application_id::text,
          app.candidate_id::text,
          result.id::text AS result_id,
          result.normalized_score
        FROM assessment_sessions s
        JOIN applications app
          ON app.organization_id = s.organization_id AND app.id = s.application_id
        LEFT JOIN LATERAL (
          SELECT id, normalized_score FROM assessment_results r
          WHERE r.organization_id = s.organization_id AND r.assessment_session_id = s.id
          ORDER BY r.created_at DESC LIMIT 1
        ) result ON true
        WHERE s.organization_id = ${organizationId}::uuid
          AND s.id = ${assessmentSessionId}::uuid
        LIMIT 1
        FOR UPDATE OF s
      `;
      const session = sessions[0];
      if (!session) throw new NotFoundException("Assessment session not found");

      const rows = await tx`
        INSERT INTO assessment_grading_reviews (
          organization_id, assessment_session_id, assessment_result_id,
          reviewer_user_id, review_state, reviewer_score, rationale
        ) VALUES (
          ${organizationId}::uuid,
          ${assessmentSessionId}::uuid,
          ${session.result_id ? String(session.result_id) : null}::uuid,
          ${reviewer}::uuid,
          ${input.reviewState},
          ${input.reviewerScore ?? null},
          ${input.rationale.trim()}
        )
        RETURNING id::text, assessment_session_id::text, assessment_result_id::text,
                  reviewer_user_id::text, review_state, reviewer_score, rationale, created_at
      `;

      let evidenceId: string | null = null;
      if (session.result_id) {
        const evidenceRows = await tx`
          INSERT INTO evidence (
            organization_id, candidate_id, application_id, evidence_type,
            source_type, source_reference, excerpt, metadata
          ) VALUES (
            ${organizationId}::uuid,
            ${String(session.candidate_id)}::uuid,
            ${String(session.application_id)}::uuid,
            'assessment_result',
            'assessment',
            ${`assessment:${assessmentSessionId}`},
            ${input.rationale.trim()},
            ${this.database.sql.json({
              assessmentSessionId,
              resultId: String(session.result_id),
              runnerScore: session.normalized_score == null ? null : Number(session.normalized_score),
              reviewerScore: input.reviewerScore ?? null,
              reviewState: input.reviewState,
            } as never)}
          )
          RETURNING id::text
        `;
        evidenceId = String(evidenceRows[0]?.id);
        await tx`
          INSERT INTO assessment_evidence_links (
            organization_id, assessment_result_id, evidence_id, criterion_id
          ) VALUES (
            ${organizationId}::uuid,
            ${String(session.result_id)}::uuid,
            ${evidenceId}::uuid,
            ${input.criterionId ?? null}::uuid
          )
        `;
      }

      await tx`
        UPDATE assessment_sessions
        SET review_state = ${input.reviewState}, reviewed_at = now(), updated_at = now()
        WHERE organization_id = ${organizationId}::uuid AND id = ${assessmentSessionId}::uuid
      `;
      return { ...rows[0], evidenceId };
    });
  }
}

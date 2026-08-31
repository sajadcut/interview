import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import { normalizeAssessmentScore } from "./assessment-runner";

const RESULT_STATUSES = new Set(["passed", "failed", "runtime_error", "timeout", "runner_error"]);

@Injectable()
export class AssessmentsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async createSession(assessmentId: string, body: unknown) {
    if (!body || typeof body !== "object") throw new Error("Assessment session input is required");
    const value = body as Record<string, unknown>;
    if (typeof value.applicationId !== "string") throw new Error("applicationId is required");
    const candidateNoticeVersion =
      typeof value.candidateNoticeVersion === "string" ? value.candidateNoticeVersion : null;

    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      INSERT INTO assessment_sessions (
        organization_id,
        assessment_id,
        application_id,
        status,
        candidate_notice_version
      ) VALUES (
        ${organizationId}::uuid,
        ${assessmentId}::uuid,
        ${value.applicationId}::uuid,
        'invited',
        ${candidateNoticeVersion}
      )
      RETURNING id, assessment_id, application_id, status, candidate_notice_version, created_at
    `;
    return rows[0];
  }

  async createSubmission(sessionId: string, body: unknown) {
    if (!body || typeof body !== "object") throw new Error("Assessment submission input is required");
    const value = body as Record<string, unknown>;
    if (typeof value.language !== "string" || !value.language.trim()) throw new Error("language is required");
    const sourceText = typeof value.sourceText === "string" ? value.sourceText : null;
    const artifactFileId = typeof value.artifactFileId === "string" ? value.artifactFileId : null;
    if (!sourceText && !artifactFileId) throw new Error("sourceText or artifactFileId is required");

    const organizationId = this.tenantContext.require().organizationId;
    const sessionRows = await this.database.sql`
      SELECT id
      FROM assessment_sessions
      WHERE organization_id = ${organizationId}::uuid AND id = ${sessionId}::uuid
      LIMIT 1
    `;
    if (!sessionRows.length) throw new Error("Assessment session not found");

    const rows = await this.database.sql`
      INSERT INTO assessment_submissions (
        organization_id,
        assessment_session_id,
        language,
        source_text,
        artifact_file_id,
        submitted_at
      ) VALUES (
        ${organizationId}::uuid,
        ${sessionId}::uuid,
        ${value.language.trim()},
        ${sourceText},
        ${artifactFileId}::uuid,
        now()
      )
      RETURNING id, assessment_session_id, language, submitted_at
    `;
    await this.database.sql`
      UPDATE assessment_sessions
      SET status = 'submitted', submitted_at = now(), updated_at = now()
      WHERE organization_id = ${organizationId}::uuid AND id = ${sessionId}::uuid
    `;
    const row = rows[0];
    return {
      id: String(row?.id),
      assessmentSessionId: String(row?.assessment_session_id),
      ...(row?.language ? { language: String(row.language) } : {}),
      submittedAt: new Date(String(row?.submitted_at)).toISOString(),
      executionBoundary: "isolated_assessment_runner_required",
    };
  }

  async recordRunnerResult(submissionId: string, body: unknown) {
    if (!body || typeof body !== "object") throw new Error("Assessment runner result is required");
    const value = body as Record<string, unknown>;
    if (typeof value.runnerType !== "string" || !value.runnerType.trim()) throw new Error("runnerType is required");
    if (typeof value.runnerVersion !== "string" || !value.runnerVersion.trim()) throw new Error("runnerVersion is required");
    if (value.runnerType === "disabled-core-process" || value.runnerType === "core-api") {
      throw new Error("Core API execution is prohibited; results must come from an isolated runner");
    }
    if (typeof value.status !== "string" || !RESULT_STATUSES.has(value.status)) throw new Error("Unsupported result status");
    if (!Number.isInteger(value.passedTests) || !Number.isInteger(value.totalTests)) {
      throw new Error("passedTests and totalTests must be integers");
    }
    const passedTests = Number(value.passedTests);
    const totalTests = Number(value.totalTests);
    const normalizedScore = normalizeAssessmentScore(passedTests, totalTests);
    const rawScore = typeof value.rawScore === "number" ? value.rawScore : passedTests;
    const details = value.details && typeof value.details === "object" && !Array.isArray(value.details)
      ? (value.details as Record<string, unknown>)
      : {};

    const organizationId = this.tenantContext.require().organizationId;
    const submissions = await this.database.sql`
      SELECT id, assessment_session_id
      FROM assessment_submissions
      WHERE organization_id = ${organizationId}::uuid AND id = ${submissionId}::uuid
      LIMIT 1
    `;
    if (!submissions.length) throw new Error("Assessment submission not found");
    const sessionId = String(submissions[0]?.assessment_session_id);

    const rows = await this.database.sql`
      INSERT INTO assessment_results (
        organization_id,
        assessment_session_id,
        submission_id,
        runner_type,
        runner_version,
        status,
        passed_tests,
        total_tests,
        raw_score,
        normalized_score,
        details
      ) VALUES (
        ${organizationId}::uuid,
        ${sessionId}::uuid,
        ${submissionId}::uuid,
        ${value.runnerType.trim()},
        ${value.runnerVersion.trim()},
        ${value.status},
        ${passedTests},
        ${totalTests},
        ${rawScore},
        ${normalizedScore},
        ${this.database.sql.json({ ...details, coreApiExecutedCode: false } as never)}
      )
      RETURNING id, submission_id, status, passed_tests, total_tests, normalized_score,
                runner_type, runner_version, details, created_at
    `;
    await this.database.sql`
      UPDATE assessment_sessions
      SET status = 'completed', updated_at = now()
      WHERE organization_id = ${organizationId}::uuid AND id = ${sessionId}::uuid
    `;
    const row = rows[0];
    return {
      id: String(row?.id),
      submissionId: String(row?.submission_id),
      status: String(row?.status),
      passedTests: Number(row?.passed_tests),
      totalTests: Number(row?.total_tests),
      normalizedScore: Number(row?.normalized_score),
      runnerType: String(row?.runner_type),
      runnerVersion: String(row?.runner_version),
      details: row?.details && typeof row.details === "object" ? (row.details as Record<string, unknown>) : {},
      createdAt: new Date(String(row?.created_at)).toISOString(),
    };
  }

  async listForApplication(applicationId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      SELECT
        s.id AS session_id,
        s.status AS session_status,
        s.started_at,
        s.submitted_at,
        s.expires_at,
        s.integrity_signals,
        a.id AS assessment_id,
        a.assessment_type,
        a.title,
        a.version,
        r.id AS result_id,
        r.status AS result_status,
        r.passed_tests,
        r.total_tests,
        r.normalized_score,
        r.runner_type,
        r.runner_version,
        r.details
      FROM assessment_sessions s
      JOIN assessments a
        ON a.organization_id = s.organization_id AND a.id = s.assessment_id
      LEFT JOIN assessment_results r
        ON r.organization_id = s.organization_id AND r.assessment_session_id = s.id
      WHERE s.organization_id = ${organizationId}::uuid
        AND s.application_id = ${applicationId}::uuid
      ORDER BY s.created_at DESC, r.created_at DESC
    `;

    return {
      applicationId,
      sessions: rows,
      safetyNotice:
        "Candidate code executes only through an isolated AssessmentRunner. Integrity signals are review aids, not automatic misconduct findings.",
    };
  }
}

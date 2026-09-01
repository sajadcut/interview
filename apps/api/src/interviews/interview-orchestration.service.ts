import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AuthContextService } from "../auth/auth-context.service";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import type {
  CreateEvaluatorCalibrationCaseDto,
  GenerateInterviewPlanDto,
  RecordEvaluatorCalibrationRunDto,
} from "./interview-orchestration.dto";

const PLAN_GENERATOR_VERSION = "deterministic-plan-v1";

function actorId(auth: AuthContextService): string {
  const userId = auth.getOptional()?.userId;
  if (!userId) throw new BadRequestException("Authenticated user context is required");
  return userId;
}

function asBenchmarkArray(value: unknown): Array<{ criterionKey: string; score: number }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.criterionKey !== "string" || typeof row.score !== "number") return [];
    return [{ criterionKey: row.criterionKey, score: row.score }];
  });
}

@Injectable()
export class InterviewOrchestrationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
    private readonly authContext: AuthContextService,
  ) {}

  async generatePlan(jobId: string, input: GenerateInterviewPlanDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const userId = actorId(this.authContext);
    const language = input.language?.trim() || "en";
    const interviewType = input.interviewType?.trim() || "structured_competency";
    const timeBudgetMinutes = input.timeBudgetMinutes ?? 45;
    const minDepth = input.minDepth ?? 1;
    const maxDepth = input.maxDepth ?? 3;
    if (maxDepth < minDepth) throw new BadRequestException("maxDepth must be greater than or equal to minDepth");
    const interviewerPolicyVersion = input.interviewerPolicyVersion?.trim() || "interviewer-policy-v1";
    const speechAvatarStackVersion = input.speechAvatarStackVersion?.trim() || "pre-realtime-contract-v1";
    const evaluatorVersion = input.evaluatorVersion?.trim() || "evidence-evaluator-v1";

    const rubricRows = await this.database.sql`
      SELECT j.title AS job_title, r.id::text AS rubric_id,
             rv.id::text AS rubric_version_id, rv.version AS rubric_version
      FROM jobs j
      JOIN rubrics r ON r.organization_id = j.organization_id AND r.job_id = j.id
      JOIN rubric_versions rv ON rv.organization_id = r.organization_id AND rv.rubric_id = r.id
      WHERE j.organization_id = ${organizationId}::uuid
        AND j.id = ${jobId}::uuid
        AND rv.status = 'published'
      ORDER BY rv.version DESC
      LIMIT 1
    `;
    const rubric = rubricRows[0];
    if (!rubric) throw new NotFoundException("Published rubric not found for job");
    const rubricVersionId = String(rubric.rubric_version_id);
    const rubricId = String(rubric.rubric_id);

    const criteriaRows = await this.database.sql`
      SELECT criterion_key, label, description, required, evidence_policy, display_order
      FROM rubric_criteria
      WHERE organization_id = ${organizationId}::uuid
        AND rubric_version_id = ${rubricVersionId}::uuid
      ORDER BY display_order, criterion_key
    `;
    const requiredCriteria = criteriaRows.filter((row) => row.required === true);
    if (requiredCriteria.length === 0) {
      throw new BadRequestException("Published rubric must contain at least one required criterion");
    }
    const criteriaStrategy = Object.fromEntries(
      requiredCriteria.map((row) => {
        const key = String(row.criterion_key);
        const description = row.description ? String(row.description).trim() : "";
        return [
          key,
          {
            objective: description || `Collect job-relevant evidence for ${String(row.label)}`,
            expectedEvidence: [description || `Concrete evidence for ${String(row.label)}`],
            minDepth,
            maxDepth,
          },
        ];
      }),
    );
    const questionStrategy = {
      version: PLAN_GENERATOR_VERSION,
      requiredCriteria: requiredCriteria.map((row) => String(row.criterion_key)),
      minDepth,
      maxDepth,
      duplicateQuestionPrevention: true,
      unsupportedQuestionGuard: true,
      criteria: criteriaStrategy,
    };
    const forbiddenTopics = (input.forbiddenTopics ?? []).map((topic) => topic.trim()).filter(Boolean);
    const recoveryPolicy = {
      resumeFromCheckpoint: true,
      deterministicFallback: true,
      maxReconnects: 3,
      preserveEvidenceGaps: true,
    };
    const rubricVersionFamily = `rubric:${rubricId}`;

    return this.database.sql.begin(async (tx) => {
      const releaseRows = await tx`
        INSERT INTO interview_release_units (
          organization_id, job_family, language, interview_type, rubric_version_family,
          interviewer_policy_version, speech_avatar_stack_version, evaluator_version,
          lifecycle_stage
        ) VALUES (
          ${organizationId}::uuid,
          ${String(rubric.job_title)},
          ${language},
          ${interviewType},
          ${rubricVersionFamily},
          ${interviewerPolicyVersion},
          ${speechAvatarStackVersion},
          ${evaluatorVersion},
          'DEV_ONLY'
        )
        ON CONFLICT (
          organization_id, job_family, language, interview_type, rubric_version_family,
          interviewer_policy_version, speech_avatar_stack_version, evaluator_version
        ) DO UPDATE SET updated_at = now()
        RETURNING id::text
      `;
      const releaseUnitId = String(releaseRows[0]?.id ?? "");
      if (!releaseUnitId) throw new Error("Unable to resolve interview release unit");
      const versionRows = await tx`
        SELECT COALESCE(max(version), 0)::int + 1 AS next_version
        FROM interview_plans
        WHERE organization_id = ${organizationId}::uuid AND job_id = ${jobId}::uuid
      `;
      const version = Number(versionRows[0]?.next_version ?? 1);
      const planRows = await tx`
        INSERT INTO interview_plans (
          organization_id, job_id, rubric_version_id, release_unit_id,
          version, status, language, interview_type, time_budget_minutes,
          question_strategy, forbidden_topics, recovery_policy,
          generated_by_user_id, generation_metadata
        ) VALUES (
          ${organizationId}::uuid,
          ${jobId}::uuid,
          ${rubricVersionId}::uuid,
          ${releaseUnitId}::uuid,
          ${version},
          'draft',
          ${language},
          ${interviewType},
          ${timeBudgetMinutes},
          ${this.database.sql.json(questionStrategy as never)},
          ${this.database.sql.json(forbiddenTopics as never)},
          ${this.database.sql.json(recoveryPolicy as never)},
          ${userId}::uuid,
          ${this.database.sql.json({
            generatorVersion: PLAN_GENERATOR_VERSION,
            rubricVersion: Number(rubric.rubric_version),
            generatedAt: new Date().toISOString(),
          } as never)}
        )
        RETURNING id::text
      `;
      return {
        id: String(planRows[0]?.id),
        jobId,
        rubricVersionId,
        releaseUnitId,
        version,
        status: "draft" as const,
        language,
        interviewType,
        timeBudgetMinutes,
        questionStrategy,
      };
    });
  }

  async publishPlan(planId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      UPDATE interview_plans p
      SET status = 'published', updated_at = now()
      FROM interview_release_units r
      WHERE p.organization_id = ${organizationId}::uuid
        AND p.id = ${planId}::uuid
        AND p.status = 'draft'
        AND r.organization_id = p.organization_id
        AND r.id = p.release_unit_id
        AND r.lifecycle_stage <> 'SUSPENDED'
      RETURNING p.id::text, p.job_id::text, p.rubric_version_id::text,
                p.release_unit_id::text, p.version, p.status, p.language,
                p.interview_type, p.time_budget_minutes, p.question_strategy
    `;
    if (!rows[0]) throw new NotFoundException("Draft interview plan eligible for publication not found");
    const row = rows[0];
    return {
      id: String(row.id),
      jobId: String(row.job_id),
      rubricVersionId: String(row.rubric_version_id),
      releaseUnitId: String(row.release_unit_id),
      version: Number(row.version),
      status: String(row.status),
      language: String(row.language),
      interviewType: String(row.interview_type),
      timeBudgetMinutes: Number(row.time_budget_minutes),
      questionStrategy: row.question_strategy as Record<string, unknown>,
    };
  }

  async evaluatorInput(sessionId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const sessions = await this.database.sql`
      SELECT s.id::text, s.status, s.application_id::text,
             p.rubric_version_id::text, p.version AS plan_version,
             r.evaluator_version
      FROM interview_sessions s
      JOIN interview_plans p ON p.organization_id = s.organization_id AND p.id = s.interview_plan_id
      JOIN interview_release_units r ON r.organization_id = p.organization_id AND r.id = p.release_unit_id
      WHERE s.organization_id = ${organizationId}::uuid AND s.id = ${sessionId}::uuid
      LIMIT 1
    `;
    const session = sessions[0];
    if (!session) throw new NotFoundException("Interview session not found");
    const rubricVersionId = String(session.rubric_version_id);
    const criteria = await this.database.sql`
      SELECT id::text, criterion_key, label, description, weight, required, evidence_policy, display_order
      FROM rubric_criteria
      WHERE organization_id = ${organizationId}::uuid
        AND rubric_version_id = ${rubricVersionId}::uuid
      ORDER BY display_order, criterion_key
    `;
    const transcript = await this.database.sql`
      SELECT id::text, speaker, start_ms, end_ms, text, stt_confidence
      FROM interview_transcript_segments
      WHERE organization_id = ${organizationId}::uuid
        AND interview_session_id = ${sessionId}::uuid
        AND is_final = true
      ORDER BY start_ms, id
    `;
    const evidence = await this.database.sql`
      SELECT id::text, criterion_id::text, turn_id::text, transcript_segment_ids,
             summary, confidence, created_at
      FROM interview_evidence
      WHERE organization_id = ${organizationId}::uuid
        AND interview_session_id = ${sessionId}::uuid
      ORDER BY created_at, id
    `;
    return {
      schemaVersion: "interview-evaluator-input-v1",
      sessionId,
      applicationId: String(session.application_id),
      sessionStatus: String(session.status),
      rubricVersionId,
      planVersion: Number(session.plan_version),
      evaluatorVersion: String(session.evaluator_version),
      criteria,
      transcript,
      evidence,
      boundaries: {
        evidenceOnly: true,
        unsupportedInference: "insufficient_evidence",
        recommendationIsDecisionSupport: true,
        finalHiringAuthority: "human",
      },
    };
  }

  async createCalibrationCase(input: CreateEvaluatorCalibrationCaseDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const userId = actorId(this.authContext);
    if (input.expectedCriteria.length === 0) {
      throw new BadRequestException("Calibration case requires at least one expected criterion score");
    }
    const rubric = await this.database.sql`
      SELECT 1 FROM rubric_versions
      WHERE organization_id = ${organizationId}::uuid AND id = ${input.rubricVersionId}::uuid
      LIMIT 1
    `;
    if (!rubric[0]) throw new NotFoundException("Rubric version not found");
    const rows = await this.database.sql`
      INSERT INTO evaluator_calibration_cases (
        organization_id, rubric_version_id, name, transcript_fixture,
        expected_criterion_results, expected_recommendation, tolerance, created_by_user_id
      ) VALUES (
        ${organizationId}::uuid,
        ${input.rubricVersionId}::uuid,
        ${input.name.trim()},
        ${this.database.sql.json(input.transcriptFixture as never)},
        ${this.database.sql.json(input.expectedCriteria as never)},
        ${input.expectedRecommendation?.trim() || null},
        ${input.tolerance ?? 10},
        ${userId}::uuid
      )
      RETURNING id::text, rubric_version_id::text, name, tolerance, active, created_at
    `;
    return rows[0];
  }

  async recordCalibrationRun(caseId: string, input: RecordEvaluatorCalibrationRunDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const cases = await this.database.sql`
      SELECT expected_criterion_results, expected_recommendation, tolerance
      FROM evaluator_calibration_cases
      WHERE organization_id = ${organizationId}::uuid
        AND id = ${caseId}::uuid AND active = true
      LIMIT 1
    `;
    const calibrationCase = cases[0];
    if (!calibrationCase) throw new NotFoundException("Active evaluator calibration case not found");
    const expected = asBenchmarkArray(calibrationCase.expected_criterion_results);
    if (expected.length === 0) throw new BadRequestException("Calibration case has no benchmark criteria");
    const actual = new Map(input.criterionResults.map((item) => [item.criterionKey, item.score]));
    const deltas = expected.map((item) => {
      const score = actual.get(item.criterionKey);
      return score === undefined ? 100 : Math.abs(score - item.score);
    });
    const meanAbsoluteScoreDelta = deltas.reduce((sum, delta) => sum + delta, 0) / deltas.length;
    const tolerance = Number(calibrationCase.tolerance ?? 10);
    const expectedRecommendation = calibrationCase.expected_recommendation
      ? String(calibrationCase.expected_recommendation)
      : null;
    const recommendationAgreement = expectedRecommendation
      ? input.recommendation?.trim() === expectedRecommendation
      : true;
    const withinTolerance = meanAbsoluteScoreDelta <= tolerance;
    const rows = await this.database.sql`
      INSERT INTO evaluator_calibration_runs (
        organization_id, calibration_case_id, evaluator_version, criterion_results,
        recommendation, mean_absolute_score_delta, recommendation_agreement,
        within_tolerance, notes
      ) VALUES (
        ${organizationId}::uuid,
        ${caseId}::uuid,
        ${input.evaluatorVersion.trim()},
        ${this.database.sql.json(input.criterionResults as never)},
        ${input.recommendation?.trim() || null},
        ${meanAbsoluteScoreDelta},
        ${recommendationAgreement},
        ${withinTolerance},
        ${input.notes?.trim() || null}
      )
      RETURNING id::text, calibration_case_id::text, evaluator_version,
                mean_absolute_score_delta, recommendation_agreement, within_tolerance, created_at
    `;
    const row = rows[0];
    return {
      id: String(row?.id),
      caseId: String(row?.calibration_case_id),
      evaluatorVersion: String(row?.evaluator_version),
      meanAbsoluteScoreDelta: Number(row?.mean_absolute_score_delta),
      recommendationAgreement: Boolean(row?.recommendation_agreement),
      withinTolerance: Boolean(row?.within_tolerance),
      createdAt: new Date(String(row?.created_at)).toISOString(),
    };
  }

  async calibrationSummary(evaluatorVersion: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const version = evaluatorVersion.trim();
    if (!version) throw new BadRequestException("evaluatorVersion is required");
    const rows = await this.database.sql`
      SELECT count(*)::int AS run_count,
             COALESCE(avg((within_tolerance::int)::numeric), 0) AS within_tolerance_rate,
             COALESCE(avg((recommendation_agreement::int)::numeric), 0) AS recommendation_agreement_rate,
             avg(mean_absolute_score_delta) AS mean_absolute_score_delta
      FROM evaluator_calibration_runs
      WHERE organization_id = ${organizationId}::uuid AND evaluator_version = ${version}
    `;
    const row = rows[0];
    return {
      evaluatorVersion: version,
      runCount: Number(row?.run_count ?? 0),
      withinToleranceRate: Number(row?.within_tolerance_rate ?? 0),
      recommendationAgreementRate: Number(row?.recommendation_agreement_rate ?? 0),
      ...(row?.mean_absolute_score_delta !== null && row?.mean_absolute_score_delta !== undefined
        ? { meanAbsoluteScoreDelta: Number(row.mean_absolute_score_delta) }
        : {}),
    };
  }
}

import { createHash } from "node:crypto";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AuthContextService } from "../auth/auth-context.service";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import { calculateRankingAgreement } from "./evaluator-calibration-analytics";
import {
  InterviewEvaluationValidationError,
  evaluateInterviewDraft,
  parseInterviewEvaluatorDraft,
  type InterviewEvaluatorOutput,
} from "./interview-evaluator";
import { InterviewEvaluatorService } from "./interview-evaluator.service";
import {
  DEFAULT_SHADOW_LOW_CONFIDENCE_THRESHOLD,
  SHADOW_POLICY_VERSION,
  compareShadowEvaluation,
  type ShadowHumanCriterionResult,
  type ShadowHumanOutcome,
  type ShadowHumanRecommendation,
} from "./evaluator-shadow-testing";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHADOW_SOURCE_TYPES = ["scorecard_review", "manual_blind_reference", "final_application_snapshot"] as const;
const SHADOW_RECOMMENDATIONS = [
  "strong_recommend",
  "review",
  "not_recommended",
  "insufficient_evidence",
] as const;
const ROOT_CAUSE_CATEGORIES = [
  "rubric_ambiguity",
  "evidence_gap",
  "transcript_quality",
  "evaluator_reasoning",
  "human_variance",
  "recommendation_threshold",
  "data_quality",
  "other",
] as const;
const ROOT_CAUSE_SEVERITIES = ["low", "moderate", "high", "critical"] as const;

type ShadowSourceType = (typeof SHADOW_SOURCE_TYPES)[number];
type RootCauseSeverity = (typeof ROOT_CAUSE_SEVERITIES)[number];

interface ShadowThresholds {
  minimumHumanOutcomeRate: number;
  minimumRecommendationAgreementRate: number;
  maximumFalseRejectRate: number;
  maximumFalsePromotionRate: number;
  maximumMeanAbsoluteScoreDelta: number;
  minimumCriterionCoverageRate: number;
  maximumLowConfidenceRate: number;
  minimumSpearmanRankingCorrelation: number;
}

const DEFAULT_THRESHOLDS: ShadowThresholds = {
  minimumHumanOutcomeRate: 0.95,
  minimumRecommendationAgreementRate: 0.8,
  maximumFalseRejectRate: 0.05,
  maximumFalsePromotionRate: 0.05,
  maximumMeanAbsoluteScoreDelta: 10,
  minimumCriterionCoverageRate: 0.95,
  maximumLowConfidenceRate: 0.25,
  minimumSpearmanRankingCorrelation: 0.75,
};

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("Request body must be an object");
  }
  return value as Record<string, unknown>;
}

function optionalObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new BadRequestException(`${field} is required`);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requiredUuid(value: unknown, field: string): string {
  const text = requiredString(value, field);
  if (!UUID_PATTERN.test(text)) throw new BadRequestException(`${field} must be a UUID`);
  return text;
}

function numberBetween(value: unknown, field: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new BadRequestException(`${field} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function actorId(auth: AuthContextService): string {
  const userId = auth.getOptional()?.userId;
  if (!userId) throw new BadRequestException("Authenticated user context is required");
  return userId;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function recommendation(value: unknown, field: string): ShadowHumanRecommendation {
  const text = requiredString(value, field);
  if (!(SHADOW_RECOMMENDATIONS as readonly string[]).includes(text)) {
    throw new BadRequestException(`${field} is not a supported recommendation`);
  }
  return text as ShadowHumanRecommendation;
}

function sourceType(value: unknown): ShadowSourceType {
  const text = requiredString(value, "sourceType");
  if (!(SHADOW_SOURCE_TYPES as readonly string[]).includes(text)) {
    throw new BadRequestException("sourceType is not supported");
  }
  return text as ShadowSourceType;
}

function criterionResults(value: unknown): ShadowHumanCriterionResult[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new BadRequestException("criterionResults must contain at least one human criterion result");
  }
  const seen = new Set<string>();
  return value.map((item, index) => {
    const row = asObject(item);
    const criterionKey = requiredString(row.criterionKey, `criterionResults[${index}].criterionKey`);
    if (seen.has(criterionKey)) throw new BadRequestException(`Duplicate human criterion ${criterionKey}`);
    seen.add(criterionKey);
    const score = numberBetween(row.score, `criterionResults[${index}].score`, 0, 100);
    let evidenceRefs: string[] | undefined;
    if (row.evidenceRefs !== undefined) {
      if (!Array.isArray(row.evidenceRefs) || !row.evidenceRefs.every((entry) => typeof entry === "string")) {
        throw new BadRequestException(`criterionResults[${index}].evidenceRefs must be a string array`);
      }
      evidenceRefs = [...new Set(row.evidenceRefs.map((entry) => entry.trim()).filter(Boolean))];
    }
    return { criterionKey, score, ...(evidenceRefs ? { evidenceRefs } : {}) };
  });
}

function thresholds(value: unknown): ShadowThresholds {
  const row = optionalObject(value);
  const pick = (key: keyof ShadowThresholds, minimum: number, maximum: number) =>
    row[key] === undefined ? DEFAULT_THRESHOLDS[key] : numberBetween(row[key], `thresholds.${key}`, minimum, maximum);
  return {
    minimumHumanOutcomeRate: pick("minimumHumanOutcomeRate", 0, 1),
    minimumRecommendationAgreementRate: pick("minimumRecommendationAgreementRate", 0, 1),
    maximumFalseRejectRate: pick("maximumFalseRejectRate", 0, 1),
    maximumFalsePromotionRate: pick("maximumFalsePromotionRate", 0, 1),
    maximumMeanAbsoluteScoreDelta: pick("maximumMeanAbsoluteScoreDelta", 0, 100),
    minimumCriterionCoverageRate: pick("minimumCriterionCoverageRate", 0, 1),
    maximumLowConfidenceRate: pick("maximumLowConfidenceRate", 0, 1),
    minimumSpearmanRankingCorrelation: pick("minimumSpearmanRankingCorrelation", -1, 1),
  };
}

function rootCauseSeverity(value: unknown): RootCauseSeverity {
  const text = optionalString(value) ?? "moderate";
  if (!(ROOT_CAUSE_SEVERITIES as readonly string[]).includes(text)) {
    throw new BadRequestException("severity is not supported");
  }
  return text as RootCauseSeverity;
}

function rootCauseCategories(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every((entry) => typeof entry === "string")) {
    throw new BadRequestException("categories must contain at least one root-cause category");
  }
  const result = [...new Set(value.map((entry) => entry.trim()).filter(Boolean))];
  const invalid = result.filter((entry) => !(ROOT_CAUSE_CATEGORIES as readonly string[]).includes(entry));
  if (invalid.length) throw new BadRequestException(`Unsupported root-cause categories: ${invalid.join(", ")}`);
  return result;
}

function isoDate(value: unknown, field: string): string {
  const text = requiredString(value, field);
  const date = new Date(text);
  if (Number.isNaN(date.valueOf())) throw new BadRequestException(`${field} must be an ISO date-time`);
  return date.toISOString();
}

function round(value: number, places = 4): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

@Injectable()
export class EvaluatorShadowTestingService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
    private readonly authContext: AuthContextService,
    private readonly evaluator: InterviewEvaluatorService,
  ) {}

  async createProgram(body: unknown) {
    const input = asObject(body);
    const organizationId = this.tenantContext.require().organizationId;
    const userId = actorId(this.authContext);
    const releaseUnitId = requiredUuid(input.releaseUnitId, "releaseUnitId");
    const releaseRows = await this.database.sql`
      SELECT id::text, evaluator_version, lifecycle_stage
      FROM interview_release_units
      WHERE organization_id = ${organizationId}::uuid AND id = ${releaseUnitId}::uuid
      LIMIT 1
    `;
    const release = releaseRows[0];
    if (!release) throw new NotFoundException("Interview release unit not found");
    const evaluatorVersion = optionalString(input.evaluatorVersion) ?? String(release.evaluator_version);
    if (evaluatorVersion !== String(release.evaluator_version)) {
      throw new BadRequestException("Shadow evaluator version must match the release unit evaluator version");
    }
    const targetSampleSize = input.targetSampleSize === undefined
      ? 50
      : numberBetween(input.targetSampleSize, "targetSampleSize", 1, 1_000_000);
    if (!Number.isInteger(targetSampleSize)) throw new BadRequestException("targetSampleSize must be an integer");
    const configuredThresholds = thresholds(input.thresholds);
    const rows = await this.database.sql`
      INSERT INTO evaluator_shadow_programs (
        organization_id, release_unit_id, name, description, evaluator_version,
        policy_version, target_sample_size, thresholds, created_by_user_id
      ) VALUES (
        ${organizationId}::uuid,
        ${releaseUnitId}::uuid,
        ${requiredString(input.name, "name")},
        ${optionalString(input.description) ?? null},
        ${evaluatorVersion},
        ${SHADOW_POLICY_VERSION},
        ${targetSampleSize},
        ${this.database.sql.json(configuredThresholds as never)},
        ${userId}::uuid
      )
      RETURNING id::text, release_unit_id::text, name, description, status,
                evaluator_version, policy_version, target_sample_size, thresholds,
                result_visibility_policy, decision_influence_prohibited, created_at, updated_at
    `;
    return this.programRow(rows[0]);
  }

  async listPrograms() {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      SELECT p.id::text, p.release_unit_id::text, p.name, p.description, p.status,
             p.evaluator_version, p.policy_version, p.target_sample_size, p.thresholds,
             p.result_visibility_policy, p.decision_influence_prohibited,
             p.activated_at, p.completed_at, p.created_at, p.updated_at,
             r.lifecycle_stage, r.job_family, r.language, r.interview_type,
             count(sr.id)::int AS run_count
      FROM evaluator_shadow_programs p
      JOIN interview_release_units r
        ON r.organization_id = p.organization_id AND r.id = p.release_unit_id
      LEFT JOIN evaluator_shadow_runs sr
        ON sr.organization_id = p.organization_id AND sr.shadow_program_id = p.id
      WHERE p.organization_id = ${organizationId}::uuid
      GROUP BY p.id, r.id
      ORDER BY p.created_at DESC
    `;
    return rows.map((row) => ({
      ...this.programRow(row),
      releaseUnit: {
        lifecycleStage: String(row.lifecycle_stage),
        jobFamily: String(row.job_family),
        language: String(row.language),
        interviewType: String(row.interview_type),
      },
      runCount: Number(row.run_count ?? 0),
    }));
  }

  async activateProgram(programId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const userId = actorId(this.authContext);
    const rows = await this.database.sql`
      SELECT p.id::text, p.status, p.evaluator_version, r.lifecycle_stage, r.evaluator_version AS release_evaluator_version
      FROM evaluator_shadow_programs p
      JOIN interview_release_units r
        ON r.organization_id = p.organization_id AND r.id = p.release_unit_id
      WHERE p.organization_id = ${organizationId}::uuid AND p.id = ${programId}::uuid
      LIMIT 1
    `;
    const program = rows[0];
    if (!program) throw new NotFoundException("Shadow program not found");
    if (String(program.lifecycle_stage) !== "SHADOW") {
      throw new BadRequestException("Shadow program can activate only when its release unit is in SHADOW stage");
    }
    if (String(program.evaluator_version) !== String(program.release_evaluator_version)) {
      throw new BadRequestException("Shadow program evaluator version no longer matches its release unit");
    }
    if (String(program.status) === "completed") throw new BadRequestException("Completed shadow program cannot be reactivated");
    const updated = await this.database.sql`
      UPDATE evaluator_shadow_programs
      SET status = 'active', activated_by_user_id = ${userId}::uuid,
          activated_at = COALESCE(activated_at, now()), updated_at = now()
      WHERE organization_id = ${organizationId}::uuid AND id = ${programId}::uuid
      RETURNING id::text, release_unit_id::text, name, description, status,
                evaluator_version, policy_version, target_sample_size, thresholds,
                result_visibility_policy, decision_influence_prohibited,
                activated_at, completed_at, created_at, updated_at
    `;
    return this.programRow(updated[0]);
  }

  async pauseProgram(programId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      UPDATE evaluator_shadow_programs
      SET status = 'paused', updated_at = now()
      WHERE organization_id = ${organizationId}::uuid AND id = ${programId}::uuid AND status = 'active'
      RETURNING id::text, release_unit_id::text, name, description, status,
                evaluator_version, policy_version, target_sample_size, thresholds,
                result_visibility_policy, decision_influence_prohibited,
                activated_at, completed_at, created_at, updated_at
    `;
    if (!rows[0]) throw new BadRequestException("Only an active shadow program can be paused");
    return this.programRow(rows[0]);
  }

  async completeProgram(programId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const userId = actorId(this.authContext);
    const rows = await this.database.sql`
      UPDATE evaluator_shadow_programs
      SET status = 'completed', completed_by_user_id = ${userId}::uuid,
          completed_at = now(), updated_at = now()
      WHERE organization_id = ${organizationId}::uuid AND id = ${programId}::uuid
        AND status IN ('active', 'paused')
      RETURNING id::text, release_unit_id::text, name, description, status,
                evaluator_version, policy_version, target_sample_size, thresholds,
                result_visibility_policy, decision_influence_prohibited,
                activated_at, completed_at, created_at, updated_at
    `;
    if (!rows[0]) throw new BadRequestException("Only an active or paused shadow program can be completed");
    return this.programRow(rows[0]);
  }

  async recordRun(programId: string, body: unknown) {
    const request = asObject(body);
    const sessionId = requiredUuid(request.sessionId, "sessionId");
    if (request.draft === undefined) throw new BadRequestException("draft is required");
    const organizationId = this.tenantContext.require().organizationId;
    const userId = actorId(this.authContext);
    const programs = await this.database.sql`
      SELECT p.id::text, p.release_unit_id::text, p.status, p.evaluator_version,
             r.lifecycle_stage, r.evaluator_version AS release_evaluator_version
      FROM evaluator_shadow_programs p
      JOIN interview_release_units r
        ON r.organization_id = p.organization_id AND r.id = p.release_unit_id
      WHERE p.organization_id = ${organizationId}::uuid AND p.id = ${programId}::uuid
      LIMIT 1
    `;
    const program = programs[0];
    if (!program) throw new NotFoundException("Shadow program not found");
    if (String(program.status) !== "active") throw new BadRequestException("Shadow program is not active");
    if (String(program.lifecycle_stage) !== "SHADOW") {
      throw new BadRequestException("Shadow runs are accepted only while the release unit remains in SHADOW stage");
    }

    const sessionRows = await this.database.sql`
      SELECT p.release_unit_id::text
      FROM interview_sessions s
      JOIN interview_plans p ON p.organization_id = s.organization_id AND p.id = s.interview_plan_id
      WHERE s.organization_id = ${organizationId}::uuid AND s.id = ${sessionId}::uuid
      LIMIT 1
    `;
    if (!sessionRows[0]) throw new NotFoundException("Interview session not found");
    if (String(sessionRows[0].release_unit_id) !== String(program.release_unit_id)) {
      throw new BadRequestException("Interview session does not belong to the shadow program release unit");
    }

    const input = await this.evaluator.buildInput(sessionId);
    if (input.sessionStatus !== "completed") {
      throw new BadRequestException("Only completed interview sessions can enter shadow evaluation");
    }
    if (input.evaluatorVersion !== String(program.evaluator_version)) {
      throw new BadRequestException("Interview evaluator version does not match the active shadow program");
    }

    let draft;
    let output: InterviewEvaluatorOutput;
    try {
      draft = parseInterviewEvaluatorDraft(request.draft);
      output = evaluateInterviewDraft(input, draft);
    } catch (error) {
      if (error instanceof InterviewEvaluationValidationError) {
        throw new BadRequestException({
          message: "Shadow evaluator output failed validation",
          issues: error.issues,
        });
      }
      throw error;
    }
    const inputFingerprint = fingerprint(input);
    const draftFingerprint = fingerprint(draft);
    const inserted = await this.database.sql`
      INSERT INTO evaluator_shadow_runs (
        organization_id, shadow_program_id, interview_session_id, application_id,
        rubric_version_id, evaluator_version, idempotency_key, input_fingerprint,
        draft_fingerprint, provider, model, prompt_version, evaluator_trace_reference,
        ai_status, ai_criterion_results, ai_recommendation, ai_overall_score,
        ai_overall_confidence, evidence_complete, validation_report, output_snapshot,
        created_by_user_id
      ) VALUES (
        ${organizationId}::uuid,
        ${programId}::uuid,
        ${sessionId}::uuid,
        ${input.applicationId}::uuid,
        ${input.rubricVersionId}::uuid,
        ${input.evaluatorVersion},
        ${draft.idempotencyKey},
        ${inputFingerprint},
        ${draftFingerprint},
        ${draft.provenance.provider},
        ${draft.provenance.model ?? null},
        ${draft.provenance.promptVersion},
        ${draft.provenance.traceReference ?? null},
        ${output.status},
        ${this.database.sql.json(output.criterionResults as never)},
        ${output.recommendation},
        ${output.overallScore},
        ${output.overallConfidence},
        ${output.evidenceComplete},
        ${this.database.sql.json(output.validation as never)},
        ${this.database.sql.json(output as never)},
        ${userId}::uuid
      )
      ON CONFLICT (organization_id, shadow_program_id, interview_session_id, idempotency_key)
      DO NOTHING
      RETURNING id::text, created_at
    `;

    let runId: string;
    let idempotentReplay = false;
    if (inserted[0]) {
      runId = String(inserted[0].id);
    } else {
      const existing = await this.database.sql`
        SELECT id::text, input_fingerprint, draft_fingerprint
        FROM evaluator_shadow_runs
        WHERE organization_id = ${organizationId}::uuid
          AND shadow_program_id = ${programId}::uuid
          AND interview_session_id = ${sessionId}::uuid
          AND idempotency_key = ${draft.idempotencyKey}
        LIMIT 1
      `;
      const row = existing[0];
      if (!row) throw new Error("Unable to resolve idempotent shadow replay");
      if (String(row.input_fingerprint) !== inputFingerprint || String(row.draft_fingerprint) !== draftFingerprint) {
        throw new BadRequestException("Shadow idempotency key was already used with different input or output");
      }
      runId = String(row.id);
      idempotentReplay = true;
    }

    const outcome = await this.database.sql`
      SELECT 1 FROM evaluator_shadow_human_outcomes
      WHERE organization_id = ${organizationId}::uuid AND shadow_run_id = ${runId}::uuid
      LIMIT 1
    `;
    return {
      runId,
      idempotentReplay,
      visibilityState: outcome[0] ? "unblinded_after_human_outcome" : "sealed",
      decisionInfluenceProhibited: true,
      writesHiringDecisionData: false,
      humanOutcomeRecorded: Boolean(outcome[0]),
    };
  }

  async getRun(runId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      SELECT r.id::text, r.shadow_program_id::text, r.interview_session_id::text,
             r.application_id::text, r.rubric_version_id::text, r.evaluator_version,
             r.provider, r.model, r.prompt_version, r.ai_status, r.ai_recommendation,
             r.ai_overall_score, r.ai_overall_confidence, r.ai_criterion_results,
             r.validation_report, r.output_snapshot, r.decision_influence_prohibited,
             r.result_visibility_policy, r.created_at,
             h.id::text AS human_outcome_id, h.source_type, h.source_reference,
             h.recommendation AS human_recommendation, h.overall_score AS human_overall_score,
             h.criterion_results AS human_criterion_results, h.application_status,
             h.pipeline_stage, h.decision_recorded_at,
             c.id::text AS comparison_id, c.criterion_comparisons, c.coverage_rate,
             c.mean_absolute_score_delta, c.root_mean_squared_score_delta,
             c.max_absolute_score_delta, c.mean_signed_score_delta,
             c.recommendation_agreement, c.overall_score_delta, c.false_reject,
             c.false_promotion, c.low_confidence, c.requires_root_cause_review,
             c.root_cause_review_state
      FROM evaluator_shadow_runs r
      LEFT JOIN evaluator_shadow_human_outcomes h
        ON h.organization_id = r.organization_id AND h.shadow_run_id = r.id
      LEFT JOIN evaluator_shadow_comparisons c
        ON c.organization_id = r.organization_id AND c.shadow_run_id = r.id
      WHERE r.organization_id = ${organizationId}::uuid AND r.id = ${runId}::uuid
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) throw new NotFoundException("Shadow run not found");
    const base = {
      runId: String(row.id),
      programId: String(row.shadow_program_id),
      interviewSessionId: String(row.interview_session_id),
      applicationId: String(row.application_id),
      evaluatorVersion: String(row.evaluator_version),
      createdAt: new Date(String(row.created_at)).toISOString(),
      decisionInfluenceProhibited: true,
      writesHiringDecisionData: false,
    };
    if (!row.human_outcome_id) {
      return {
        ...base,
        visibilityState: "sealed",
        humanOutcomeRecorded: false,
        aiResult: null,
        comparison: null,
      };
    }
    const rootCauses = row.comparison_id
      ? await this.database.sql`
          SELECT id::text, categories, severity, notes, created_at
          FROM evaluator_shadow_root_cause_reviews
          WHERE organization_id = ${organizationId}::uuid
            AND shadow_comparison_id = ${String(row.comparison_id)}::uuid
          ORDER BY created_at, id
        `
      : [];
    return {
      ...base,
      visibilityState: "unblinded_after_human_outcome",
      humanOutcomeRecorded: true,
      aiResult: row.output_snapshot as InterviewEvaluatorOutput,
      humanOutcome: {
        id: String(row.human_outcome_id),
        sourceType: String(row.source_type),
        sourceReference: row.source_reference ? String(row.source_reference) : null,
        recommendation: String(row.human_recommendation),
        overallScore: row.human_overall_score === null ? null : Number(row.human_overall_score),
        criterionResults: row.human_criterion_results,
        applicationStatus: row.application_status ? String(row.application_status) : null,
        pipelineStage: row.pipeline_stage ? String(row.pipeline_stage) : null,
        decisionRecordedAt: new Date(String(row.decision_recorded_at)).toISOString(),
      },
      comparison: row.comparison_id
        ? {
            id: String(row.comparison_id),
            criterionComparisons: row.criterion_comparisons,
            coverageRate: Number(row.coverage_rate),
            meanAbsoluteScoreDelta: row.mean_absolute_score_delta === null ? null : Number(row.mean_absolute_score_delta),
            rootMeanSquaredScoreDelta: row.root_mean_squared_score_delta === null ? null : Number(row.root_mean_squared_score_delta),
            maxAbsoluteScoreDelta: row.max_absolute_score_delta === null ? null : Number(row.max_absolute_score_delta),
            meanSignedScoreDelta: row.mean_signed_score_delta === null ? null : Number(row.mean_signed_score_delta),
            recommendationAgreement: Boolean(row.recommendation_agreement),
            overallScoreDelta: row.overall_score_delta === null ? null : Number(row.overall_score_delta),
            falseReject: Boolean(row.false_reject),
            falsePromotion: Boolean(row.false_promotion),
            lowConfidence: Boolean(row.low_confidence),
            requiresRootCauseReview: Boolean(row.requires_root_cause_review),
            rootCauseReviewState: String(row.root_cause_review_state),
            rootCauseReviews: rootCauses.map((review) => ({
              id: String(review.id),
              categories: review.categories,
              severity: String(review.severity),
              notes: String(review.notes),
              createdAt: new Date(String(review.created_at)).toISOString(),
            })),
          }
        : null,
    };
  }

  async recordHumanOutcome(runId: string, body: unknown) {
    const input = asObject(body);
    const organizationId = this.tenantContext.require().organizationId;
    const reviewerUserId = actorId(this.authContext);
    const source = sourceType(input.sourceType);
    const criteria = criterionResults(input.criterionResults);
    const sourceReference = optionalString(input.sourceReference);
    const notes = optionalString(input.notes);

    return this.database.sql.begin(async (tx) => {
      const runs = await tx`
        SELECT r.id::text, r.application_id::text, r.rubric_version_id::text,
               r.output_snapshot, a.status AS application_status, a.pipeline_stage
        FROM evaluator_shadow_runs r
        JOIN applications a ON a.organization_id = r.organization_id AND a.id = r.application_id
        WHERE r.organization_id = ${organizationId}::uuid AND r.id = ${runId}::uuid
        LIMIT 1
      `;
      const run = runs[0];
      if (!run) throw new NotFoundException("Shadow run not found");
      const existing = await tx`
        SELECT id::text FROM evaluator_shadow_human_outcomes
        WHERE organization_id = ${organizationId}::uuid AND shadow_run_id = ${runId}::uuid
        LIMIT 1
      `;
      if (existing[0]) throw new BadRequestException("Shadow human outcome is immutable once recorded");

      const rubricRows = await tx`
        SELECT criterion_key
        FROM rubric_criteria
        WHERE organization_id = ${organizationId}::uuid
          AND rubric_version_id = ${String(run.rubric_version_id)}::uuid
      `;
      const validKeys = new Set(rubricRows.map((row) => String(row.criterion_key)));
      const invalid = criteria.map((item) => item.criterionKey).filter((key) => !validKeys.has(key));
      if (invalid.length) throw new BadRequestException(`Human outcome contains unknown rubric criteria: ${invalid.join(", ")}`);

      let humanRecommendation: ShadowHumanRecommendation;
      let humanOverallScore: number | undefined;
      let decisionRecordedAt: string;
      if (source === "scorecard_review") {
        if (!sourceReference || !UUID_PATTERN.test(sourceReference)) {
          throw new BadRequestException("scorecard_review source requires a UUID sourceReference");
        }
        const reviewRows = await tx`
          SELECT human_recommendation, human_overall_score, created_at
          FROM scorecard_reviews
          WHERE organization_id = ${organizationId}::uuid
            AND id = ${sourceReference}::uuid
            AND application_id = ${String(run.application_id)}::uuid
          LIMIT 1
        `;
        const review = reviewRows[0];
        if (!review) throw new NotFoundException("Scorecard human review not found for shadow application");
        humanRecommendation = recommendation(
          review.human_recommendation ?? input.recommendation,
          "recommendation",
        );
        humanOverallScore = review.human_overall_score === null || review.human_overall_score === undefined
          ? (input.overallScore === undefined ? undefined : numberBetween(input.overallScore, "overallScore", 0, 100))
          : Number(review.human_overall_score);
        decisionRecordedAt = new Date(String(review.created_at)).toISOString();
      } else {
        humanRecommendation = recommendation(input.recommendation, "recommendation");
        humanOverallScore = input.overallScore === undefined
          ? undefined
          : numberBetween(input.overallScore, "overallScore", 0, 100);
        decisionRecordedAt = isoDate(input.decisionRecordedAt, "decisionRecordedAt");
      }

      const human: ShadowHumanOutcome = {
        recommendation: humanRecommendation,
        ...(humanOverallScore !== undefined ? { overallScore: humanOverallScore } : {}),
        criterionResults: criteria,
      };
      const ai = run.output_snapshot as InterviewEvaluatorOutput;
      const comparison = compareShadowEvaluation(ai, human, {
        lowConfidenceThreshold: DEFAULT_SHADOW_LOW_CONFIDENCE_THRESHOLD,
      });
      const outcomeRows = await tx`
        INSERT INTO evaluator_shadow_human_outcomes (
          organization_id, shadow_run_id, reviewer_user_id, source_type,
          source_reference, recommendation, overall_score, criterion_results,
          application_status, pipeline_stage, decision_recorded_at, notes
        ) VALUES (
          ${organizationId}::uuid,
          ${runId}::uuid,
          ${reviewerUserId}::uuid,
          ${source},
          ${sourceReference ?? null},
          ${humanRecommendation},
          ${humanOverallScore ?? null},
          ${this.database.sql.json(criteria as never)},
          ${String(run.application_status)},
          ${String(run.pipeline_stage)},
          ${decisionRecordedAt}::timestamptz,
          ${notes ?? null}
        )
        RETURNING id::text
      `;
      const humanOutcomeId = String(outcomeRows[0]?.id);
      const comparisonRows = await tx`
        INSERT INTO evaluator_shadow_comparisons (
          organization_id, shadow_run_id, human_outcome_id, policy_version,
          criterion_comparisons, reference_criterion_count, matched_criterion_count,
          coverage_rate, mean_absolute_score_delta, root_mean_squared_score_delta,
          max_absolute_score_delta, mean_signed_score_delta, recommendation_agreement,
          overall_score_delta, false_reject, false_promotion, low_confidence,
          requires_root_cause_review, root_cause_review_state
        ) VALUES (
          ${organizationId}::uuid,
          ${runId}::uuid,
          ${humanOutcomeId}::uuid,
          ${comparison.policyVersion},
          ${this.database.sql.json(comparison.criterionComparisons as never)},
          ${comparison.referenceCriterionCount},
          ${comparison.matchedCriterionCount},
          ${comparison.coverageRate},
          ${comparison.meanAbsoluteScoreDelta},
          ${comparison.rootMeanSquaredScoreDelta},
          ${comparison.maxAbsoluteScoreDelta},
          ${comparison.meanSignedScoreDelta},
          ${comparison.recommendationAgreement},
          ${comparison.overallScoreDelta},
          ${comparison.falseReject},
          ${comparison.falsePromotion},
          ${comparison.lowConfidence},
          ${comparison.requiresRootCauseReview},
          ${comparison.requiresRootCauseReview ? "pending" : "not_required"}
        )
        RETURNING id::text
      `;
      return {
        runId,
        humanOutcomeId,
        comparisonId: String(comparisonRows[0]?.id),
        visibilityState: "unblinded_after_human_outcome",
        decisionInfluenceProhibited: true,
        writesHiringDecisionData: false,
        comparison,
      };
    });
  }

  async recordRootCauseReview(comparisonId: string, body: unknown) {
    const input = asObject(body);
    const organizationId = this.tenantContext.require().organizationId;
    const reviewerUserId = actorId(this.authContext);
    const categories = rootCauseCategories(input.categories);
    const severity = rootCauseSeverity(input.severity);
    const notes = requiredString(input.notes, "notes");
    const comparisons = await this.database.sql`
      SELECT id::text, requires_root_cause_review
      FROM evaluator_shadow_comparisons
      WHERE organization_id = ${organizationId}::uuid AND id = ${comparisonId}::uuid
      LIMIT 1
    `;
    const comparison = comparisons[0];
    if (!comparison) throw new NotFoundException("Shadow comparison not found");
    if (!comparison.requires_root_cause_review) {
      throw new BadRequestException("This shadow comparison does not require root-cause review");
    }
    const rows = await this.database.sql.begin(async (tx) => {
      const inserted = await tx`
        INSERT INTO evaluator_shadow_root_cause_reviews (
          organization_id, shadow_comparison_id, reviewer_user_id, categories, severity, notes
        ) VALUES (
          ${organizationId}::uuid,
          ${comparisonId}::uuid,
          ${reviewerUserId}::uuid,
          ${this.database.sql.json(categories as never)},
          ${severity},
          ${notes}
        )
        RETURNING id::text, categories, severity, notes, created_at
      `;
      await tx`
        UPDATE evaluator_shadow_comparisons
        SET root_cause_review_state = 'completed'
        WHERE organization_id = ${organizationId}::uuid AND id = ${comparisonId}::uuid
      `;
      return inserted;
    });
    const row = rows[0];
    return {
      id: String(row?.id),
      comparisonId,
      categories: row?.categories,
      severity: String(row?.severity),
      notes: String(row?.notes),
      createdAt: new Date(String(row?.created_at)).toISOString(),
    };
  }

  async summary(programId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const programRows = await this.database.sql`
      SELECT p.id::text, p.release_unit_id::text, p.name, p.status, p.evaluator_version,
             p.policy_version, p.target_sample_size, p.thresholds,
             p.decision_influence_prohibited, r.lifecycle_stage, r.job_family,
             r.language, r.interview_type
      FROM evaluator_shadow_programs p
      JOIN interview_release_units r
        ON r.organization_id = p.organization_id AND r.id = p.release_unit_id
      WHERE p.organization_id = ${organizationId}::uuid AND p.id = ${programId}::uuid
      LIMIT 1
    `;
    const program = programRows[0];
    if (!program) throw new NotFoundException("Shadow program not found");
    const rows = await this.database.sql`
      SELECT r.id::text, r.ai_overall_score, r.ai_overall_confidence,
             h.id::text AS human_outcome_id, h.overall_score AS human_overall_score,
             c.id::text AS comparison_id, c.coverage_rate, c.mean_absolute_score_delta,
             c.recommendation_agreement, c.false_reject, c.false_promotion,
             c.low_confidence, c.requires_root_cause_review, c.root_cause_review_state
      FROM evaluator_shadow_runs r
      LEFT JOIN evaluator_shadow_human_outcomes h
        ON h.organization_id = r.organization_id AND h.shadow_run_id = r.id
      LEFT JOIN evaluator_shadow_comparisons c
        ON c.organization_id = r.organization_id AND c.shadow_run_id = r.id
      WHERE r.organization_id = ${organizationId}::uuid
        AND r.shadow_program_id = ${programId}::uuid
      ORDER BY r.created_at, r.id
    `;
    const totalRuns = rows.length;
    const humanOutcomeCount = rows.filter((row) => row.human_outcome_id).length;
    const comparisons = rows.filter((row) => row.comparison_id);
    const comparisonCount = comparisons.length;
    const ratio = (count: number, denominator: number) => denominator ? round(count / denominator) : 0;
    const humanOutcomeRate = ratio(humanOutcomeCount, totalRuns);
    const recommendationAgreementRate = ratio(
      comparisons.filter((row) => row.recommendation_agreement === true).length,
      comparisonCount,
    );
    const falseRejectRate = ratio(comparisons.filter((row) => row.false_reject === true).length, comparisonCount);
    const falsePromotionRate = ratio(comparisons.filter((row) => row.false_promotion === true).length, comparisonCount);
    const lowConfidenceRate = ratio(comparisons.filter((row) => row.low_confidence === true).length, comparisonCount);
    const maeValues = comparisons
      .filter((row) => row.mean_absolute_score_delta !== null && row.mean_absolute_score_delta !== undefined)
      .map((row) => Number(row.mean_absolute_score_delta));
    const coverageValues = comparisons.map((row) => Number(row.coverage_rate));
    const meanAbsoluteScoreDelta = maeValues.length
      ? round(maeValues.reduce((sum, value) => sum + value, 0) / maeValues.length)
      : null;
    const meanCriterionCoverageRate = coverageValues.length
      ? round(coverageValues.reduce((sum, value) => sum + value, 0) / coverageValues.length)
      : 0;
    const rankingPairs = rows.flatMap((row) =>
      row.ai_overall_score !== null && row.human_overall_score !== null && row.human_overall_score !== undefined
        ? [{ aiScore: Number(row.ai_overall_score), humanScore: Number(row.human_overall_score) }]
        : [],
    );
    const ranking = calculateRankingAgreement(rankingPairs);
    const rootCausePendingCount = comparisons.filter(
      (row) => row.requires_root_cause_review === true && String(row.root_cause_review_state) === "pending",
    ).length;
    const configured = thresholds(program.thresholds);
    const targetSampleSize = Number(program.target_sample_size);
    const evidenceReady = totalRuns >= targetSampleSize && comparisonCount >= targetSampleSize;
    const checks = {
      targetSampleSize: evidenceReady,
      humanOutcomeRate: humanOutcomeRate >= configured.minimumHumanOutcomeRate,
      recommendationAgreementRate:
        recommendationAgreementRate >= configured.minimumRecommendationAgreementRate,
      falseRejectRate: falseRejectRate <= configured.maximumFalseRejectRate,
      falsePromotionRate: falsePromotionRate <= configured.maximumFalsePromotionRate,
      meanAbsoluteScoreDelta:
        meanAbsoluteScoreDelta !== null && meanAbsoluteScoreDelta <= configured.maximumMeanAbsoluteScoreDelta,
      criterionCoverageRate: meanCriterionCoverageRate >= configured.minimumCriterionCoverageRate,
      lowConfidenceRate: lowConfidenceRate <= configured.maximumLowConfidenceRate,
      rankingCorrelation:
        ranking.spearmanRankingCorrelation !== null &&
        ranking.spearmanRankingCorrelation >= configured.minimumSpearmanRankingCorrelation,
      rootCauseReview: rootCausePendingCount === 0,
    };
    const gateStatus = !evidenceReady
      ? "not_ready"
      : Object.values(checks).every(Boolean)
        ? "passed"
        : "failed";
    return {
      program: {
        id: String(program.id),
        releaseUnitId: String(program.release_unit_id),
        name: String(program.name),
        status: String(program.status),
        evaluatorVersion: String(program.evaluator_version),
        policyVersion: String(program.policy_version),
        lifecycleStage: String(program.lifecycle_stage),
        jobFamily: String(program.job_family),
        language: String(program.language),
        interviewType: String(program.interview_type),
        targetSampleSize,
      },
      metrics: {
        totalRuns,
        humanOutcomeCount,
        comparisonCount,
        humanOutcomeRate,
        recommendationAgreementRate,
        falseRejectRate,
        falsePromotionRate,
        lowConfidenceRate,
        meanAbsoluteScoreDelta,
        meanCriterionCoverageRate,
        rootCausePendingCount,
        ranking,
      },
      gate: {
        status: gateStatus,
        thresholds: configured,
        checks,
        releaseAuthority: false,
        note: "Shadow evidence is decision-support validation only and cannot approve production or hiring decisions by itself.",
      },
      decisionInfluenceProhibited: true,
      writesHiringDecisionData: false,
    };
  }

  private programRow(row: Record<string, unknown> | undefined) {
    if (!row) throw new Error("Shadow program persistence returned no row");
    return {
      id: String(row.id),
      releaseUnitId: String(row.release_unit_id),
      name: String(row.name),
      description: row.description ? String(row.description) : null,
      status: String(row.status),
      evaluatorVersion: String(row.evaluator_version),
      policyVersion: String(row.policy_version),
      targetSampleSize: Number(row.target_sample_size),
      thresholds: row.thresholds,
      resultVisibilityPolicy: String(row.result_visibility_policy),
      decisionInfluenceProhibited: Boolean(row.decision_influence_prohibited),
      activatedAt: row.activated_at ? new Date(String(row.activated_at)).toISOString() : null,
      completedAt: row.completed_at ? new Date(String(row.completed_at)).toISOString() : null,
      createdAt: row.created_at ? new Date(String(row.created_at)).toISOString() : null,
      updatedAt: row.updated_at ? new Date(String(row.updated_at)).toISOString() : null,
    };
  }
}

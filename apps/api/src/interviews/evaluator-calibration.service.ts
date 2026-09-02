import { createHash } from "node:crypto";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AuthContextService } from "../auth/auth-context.service";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import {
  compareEvaluatorCalibration,
  evaluateCalibrationGate,
  type CalibrationCriterionValue,
  type CalibrationGateAggregate,
  type CalibrationGateThresholds,
} from "./evaluator-calibration";

function object(value: unknown): Record<string, unknown> {
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

function evidenceRefs(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new BadRequestException("evidenceRefs must be a string array");
  }
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
}

function criterionValues(value: unknown, field: string): CalibrationCriterionValue[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new BadRequestException(`${field} must contain at least one criterion`);
  }
  const keys = new Set<string>();
  return value.map((item, index) => {
    const row = object(item);
    const criterionKey = requiredString(row.criterionKey, `${field}[${index}].criterionKey`);
    if (keys.has(criterionKey)) throw new BadRequestException(`${field} contains duplicate criterion ${criterionKey}`);
    keys.add(criterionKey);
    const score = numberBetween(row.score, `${field}[${index}].score`, 0, 100);
    const confidence = row.confidence === undefined
      ? undefined
      : numberBetween(row.confidence, `${field}[${index}].confidence`, 0, 1);
    const refs = evidenceRefs(row.evidenceRefs);
    return {
      criterionKey,
      score,
      ...(confidence !== undefined ? { confidence } : {}),
      ...(refs !== undefined ? { evidenceRefs: refs } : {}),
    };
  });
}

function gateThresholds(value: unknown): CalibrationGateThresholds {
  const row = object(value);
  const minimumCaseCount = numberBetween(row.minimumCaseCount, "thresholds.minimumCaseCount", 1, 1_000_000);
  if (!Number.isInteger(minimumCaseCount)) {
    throw new BadRequestException("thresholds.minimumCaseCount must be an integer");
  }
  const thresholds: CalibrationGateThresholds = {
    minimumCaseCount,
    minimumCoverageRate: numberBetween(row.minimumCoverageRate, "thresholds.minimumCoverageRate", 0, 1),
    maximumMeanAbsoluteScoreDelta: numberBetween(
      row.maximumMeanAbsoluteScoreDelta,
      "thresholds.maximumMeanAbsoluteScoreDelta",
      0,
      100,
    ),
    minimumWithinToleranceRate: numberBetween(
      row.minimumWithinToleranceRate,
      "thresholds.minimumWithinToleranceRate",
      0,
      1,
    ),
    minimumRecommendationAgreementRate: numberBetween(
      row.minimumRecommendationAgreementRate,
      "thresholds.minimumRecommendationAgreementRate",
      0,
      1,
    ),
    maximumFalseRejectRate: numberBetween(
      row.maximumFalseRejectRate,
      "thresholds.maximumFalseRejectRate",
      0,
      1,
    ),
    maximumFalsePromotionRate: numberBetween(
      row.maximumFalsePromotionRate,
      "thresholds.maximumFalsePromotionRate",
      0,
      1,
    ),
  };
  if (row.minimumEvidenceAgreementRate !== undefined) {
    thresholds.minimumEvidenceAgreementRate = numberBetween(
      row.minimumEvidenceAgreementRate,
      "thresholds.minimumEvidenceAgreementRate",
      0,
      1,
    );
  }
  return thresholds;
}

function storedCriterionValues(value: unknown): CalibrationCriterionValue[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    if (typeof row.criterionKey !== "string" || typeof row.score !== "number") return [];
    return [{
      criterionKey: row.criterionKey,
      score: row.score,
      ...(typeof row.confidence === "number" ? { confidence: row.confidence } : {}),
      ...(Array.isArray(row.evidenceRefs) ? { evidenceRefs: row.evidenceRefs.map(String) } : {}),
    }];
  });
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function rowNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

@Injectable()
export class EvaluatorCalibrationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
    private readonly authContext: AuthContextService,
  ) {}

  async createDataset(body: unknown) {
    const input = object(body);
    const organizationId = this.tenantContext.require().organizationId;
    const userId = actorId(this.authContext);
    const thresholds = gateThresholds(input.thresholds);
    const rows = await this.database.sql`
      INSERT INTO evaluator_calibration_datasets (
        organization_id, dataset_key, version, name, description,
        thresholds, threshold_policy_version, created_by_user_id
      ) VALUES (
        ${organizationId}::uuid,
        ${requiredString(input.datasetKey, "datasetKey")},
        ${requiredString(input.version, "version")},
        ${requiredString(input.name, "name")},
        ${optionalString(input.description) ?? null},
        ${this.database.sql.json(thresholds as never)},
        'calibration-gate-v1',
        ${userId}::uuid
      )
      RETURNING id::text, dataset_key, version, name, description, status,
                thresholds, threshold_policy_version, created_at, updated_at
    `;
    return this.datasetRow(rows[0]);
  }

  async listDatasets() {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      SELECT d.id::text, d.dataset_key, d.version, d.name, d.description, d.status,
             d.thresholds, d.threshold_policy_version, d.locked_at, d.created_at, d.updated_at,
             count(c.id)::int AS case_count,
             count(c.reference_review_id)::int AS reference_case_count
      FROM evaluator_calibration_datasets d
      LEFT JOIN evaluator_calibration_cases c
        ON c.organization_id = d.organization_id AND c.dataset_id = d.id AND c.active = true
      WHERE d.organization_id = ${organizationId}::uuid
      GROUP BY d.id
      ORDER BY d.created_at DESC
    `;
    return rows.map((row) => ({
      ...this.datasetRow(row),
      caseCount: Number(row.case_count ?? 0),
      referenceCaseCount: Number(row.reference_case_count ?? 0),
    }));
  }

  async createCase(datasetId: string, body: unknown) {
    const input = object(body);
    const organizationId = this.tenantContext.require().organizationId;
    const userId = actorId(this.authContext);
    const rubricVersionId = requiredString(input.rubricVersionId, "rubricVersionId");
    const dataset = await this.database.sql`
      SELECT id FROM evaluator_calibration_datasets
      WHERE organization_id = ${organizationId}::uuid AND id = ${datasetId}::uuid AND status = 'draft'
      LIMIT 1
    `;
    if (!dataset[0]) throw new BadRequestException("Calibration dataset must be draft to add cases");
    const rubric = await this.database.sql`
      SELECT 1 FROM rubric_versions
      WHERE organization_id = ${organizationId}::uuid AND id = ${rubricVersionId}::uuid
      LIMIT 1
    `;
    if (!rubric[0]) throw new NotFoundException("Rubric version not found");
    const fixture = input.transcriptFixture ?? [];
    if (!Array.isArray(fixture)) throw new BadRequestException("transcriptFixture must be an array");
    const tolerance = input.tolerance === undefined ? 10 : numberBetween(input.tolerance, "tolerance", 0, 100);
    const rows = await this.database.sql`
      INSERT INTO evaluator_calibration_cases (
        organization_id, dataset_id, case_key, rubric_version_id, name,
        transcript_fixture, expected_criterion_results, tolerance, active,
        language, job_family, interview_type, context, created_by_user_id
      ) VALUES (
        ${organizationId}::uuid,
        ${datasetId}::uuid,
        ${requiredString(input.caseKey, "caseKey")},
        ${rubricVersionId}::uuid,
        ${requiredString(input.name, "name")},
        ${this.database.sql.json(fixture as never)},
        '[]'::jsonb,
        ${tolerance},
        true,
        ${optionalString(input.language) ?? null},
        ${optionalString(input.jobFamily) ?? null},
        ${optionalString(input.interviewType) ?? null},
        ${this.database.sql.json(optionalObject(input.context) as never)},
        ${userId}::uuid
      )
      RETURNING id::text, dataset_id::text, case_key, rubric_version_id::text, name,
                tolerance, language, job_family, interview_type, active, reference_review_id::text, created_at
    `;
    return this.caseRow(rows[0]);
  }

  async listCases(datasetId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      SELECT c.id::text, c.dataset_id::text, c.case_key, c.rubric_version_id::text, c.name,
             c.tolerance, c.language, c.job_family, c.interview_type, c.active,
             c.reference_review_id::text, c.created_at,
             count(hr.id)::int AS human_review_count
      FROM evaluator_calibration_cases c
      LEFT JOIN evaluator_calibration_human_reviews hr
        ON hr.organization_id = c.organization_id AND hr.calibration_case_id = c.id
      WHERE c.organization_id = ${organizationId}::uuid AND c.dataset_id = ${datasetId}::uuid
      GROUP BY c.id
      ORDER BY c.created_at, c.id
    `;
    return rows.map((row) => ({ ...this.caseRow(row), humanReviewCount: Number(row.human_review_count ?? 0) }));
  }

  async addHumanReview(caseId: string, body: unknown) {
    const input = object(body);
    const organizationId = this.tenantContext.require().organizationId;
    const userId = actorId(this.authContext);
    const criteria = criterionValues(input.criterionResults, "criterionResults");
    const setAsReference = input.setAsReference === true;
    const cases = await this.database.sql`
      SELECT c.id::text, c.rubric_version_id::text, c.dataset_id::text, d.status AS dataset_status
      FROM evaluator_calibration_cases c
      JOIN evaluator_calibration_datasets d
        ON d.organization_id = c.organization_id AND d.id = c.dataset_id
      WHERE c.organization_id = ${organizationId}::uuid AND c.id = ${caseId}::uuid AND c.active = true
      LIMIT 1
    `;
    const calibrationCase = cases[0];
    if (!calibrationCase) throw new NotFoundException("Calibration case not found");
    if (String(calibrationCase.dataset_status) !== "draft") {
      throw new BadRequestException("Human references are immutable after the calibration dataset is locked");
    }
    const rubricRows = await this.database.sql`
      SELECT criterion_key, required
      FROM rubric_criteria
      WHERE organization_id = ${organizationId}::uuid
        AND rubric_version_id = ${String(calibrationCase.rubric_version_id)}::uuid
    `;
    const validKeys = new Set(rubricRows.map((row) => String(row.criterion_key)));
    const invalidKeys = criteria.map((item) => item.criterionKey).filter((key) => !validKeys.has(key));
    if (invalidKeys.length) throw new BadRequestException(`Human review contains unknown rubric criteria: ${invalidKeys.join(", ")}`);
    if (setAsReference) {
      const provided = new Set(criteria.map((item) => item.criterionKey));
      const missingRequired = rubricRows
        .filter((row) => row.required === true)
        .map((row) => String(row.criterion_key))
        .filter((key) => !provided.has(key));
      if (missingRequired.length) {
        throw new BadRequestException(`Reference review is missing required criteria: ${missingRequired.join(", ")}`);
      }
    }
    const recommendation = optionalString(input.recommendation);
    const overallScore = input.overallScore === undefined
      ? undefined
      : numberBetween(input.overallScore, "overallScore", 0, 100);
    const confidence = input.confidence === undefined
      ? undefined
      : numberBetween(input.confidence, "confidence", 0, 1);
    const reviewerReference = optionalString(input.reviewerReference);
    const notes = optionalString(input.notes);

    return this.database.sql.begin(async (tx) => {
      const versionRows = await tx`
        SELECT COALESCE(max(review_version), 0)::int + 1 AS next_version
        FROM evaluator_calibration_human_reviews
        WHERE organization_id = ${organizationId}::uuid AND calibration_case_id = ${caseId}::uuid
      `;
      const reviewVersion = Number(versionRows[0]?.next_version ?? 1);
      if (setAsReference) {
        await tx`
          UPDATE evaluator_calibration_human_reviews
          SET is_reference = false, updated_at = now()
          WHERE organization_id = ${organizationId}::uuid
            AND calibration_case_id = ${caseId}::uuid AND is_reference = true
        `;
      }
      const rows = await tx`
        INSERT INTO evaluator_calibration_human_reviews (
          organization_id, calibration_case_id, review_version, reviewer_user_id,
          reviewer_reference, status, criterion_results, recommendation,
          overall_score, confidence, evidence_references, notes, is_reference
        ) VALUES (
          ${organizationId}::uuid,
          ${caseId}::uuid,
          ${reviewVersion},
          ${userId}::uuid,
          ${reviewerReference ?? null},
          ${setAsReference ? "adjudicated" : "submitted"},
          ${this.database.sql.json(criteria as never)},
          ${recommendation ?? null},
          ${overallScore ?? null},
          ${confidence ?? null},
          ${this.database.sql.json(Object.fromEntries(criteria.map((item) => [item.criterionKey, item.evidenceRefs ?? []])) as never)},
          ${notes ?? null},
          ${setAsReference}
        )
        RETURNING id::text, calibration_case_id::text, review_version, reviewer_user_id::text,
                  reviewer_reference, status, criterion_results, recommendation, overall_score,
                  confidence, is_reference, created_at
      `;
      const review = rows[0];
      if (setAsReference) {
        await tx`
          UPDATE evaluator_calibration_cases
          SET reference_review_id = ${String(review?.id)}::uuid, updated_at = now()
          WHERE organization_id = ${organizationId}::uuid AND id = ${caseId}::uuid
        `;
      }
      return this.humanReviewRow(review);
    });
  }

  async lockDataset(datasetId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const userId = actorId(this.authContext);
    return this.database.sql.begin(async (tx) => {
      const datasets = await tx`
        SELECT id::text, status
        FROM evaluator_calibration_datasets
        WHERE organization_id = ${organizationId}::uuid AND id = ${datasetId}::uuid
        LIMIT 1 FOR UPDATE
      `;
      const dataset = datasets[0];
      if (!dataset) throw new NotFoundException("Calibration dataset not found");
      if (String(dataset.status) === "locked") return { id: datasetId, status: "locked", idempotentReplay: true };
      if (String(dataset.status) !== "draft") throw new BadRequestException("Only draft calibration datasets can be locked");
      const counts = await tx`
        SELECT count(*)::int AS case_count,
               count(reference_review_id)::int AS reference_count
        FROM evaluator_calibration_cases
        WHERE organization_id = ${organizationId}::uuid AND dataset_id = ${datasetId}::uuid AND active = true
      `;
      const caseCount = Number(counts[0]?.case_count ?? 0);
      const referenceCount = Number(counts[0]?.reference_count ?? 0);
      if (caseCount === 0) throw new BadRequestException("Calibration dataset must contain at least one active case before lock");
      if (referenceCount !== caseCount) {
        throw new BadRequestException("Every active calibration case must have an adjudicated human reference before lock");
      }
      await tx`
        UPDATE evaluator_calibration_datasets
        SET status = 'locked', locked_by_user_id = ${userId}::uuid,
            locked_at = now(), updated_at = now()
        WHERE organization_id = ${organizationId}::uuid AND id = ${datasetId}::uuid
      `;
      return { id: datasetId, status: "locked", idempotentReplay: false, caseCount };
    });
  }

  async recordRun(caseId: string, body: unknown) {
    const input = object(body);
    const organizationId = this.tenantContext.require().organizationId;
    const userId = actorId(this.authContext);
    const evaluatorVersion = requiredString(input.evaluatorVersion, "evaluatorVersion");
    const idempotencyKey = requiredString(input.idempotencyKey, "idempotencyKey");
    const aiCriteria = criterionValues(input.criterionResults, "criterionResults");
    const cases = await this.database.sql`
      SELECT c.id::text, c.dataset_id::text, c.reference_review_id::text,
             c.tolerance, d.status AS dataset_status,
             hr.criterion_results AS reference_criteria, hr.recommendation AS human_recommendation
      FROM evaluator_calibration_cases c
      JOIN evaluator_calibration_datasets d
        ON d.organization_id = c.organization_id AND d.id = c.dataset_id
      JOIN evaluator_calibration_human_reviews hr
        ON hr.organization_id = c.organization_id AND hr.id = c.reference_review_id AND hr.is_reference = true
      WHERE c.organization_id = ${organizationId}::uuid AND c.id = ${caseId}::uuid AND c.active = true
      LIMIT 1
    `;
    const calibrationCase = cases[0];
    if (!calibrationCase) throw new NotFoundException("Calibration case with adjudicated human reference not found");
    if (String(calibrationCase.dataset_status) !== "locked") {
      throw new BadRequestException("Calibration dataset must be locked before AI comparison runs are recorded");
    }
    const referenceCriteria = storedCriterionValues(calibrationCase.reference_criteria);
    if (!referenceCriteria.length) throw new BadRequestException("Human reference contains no criterion results");
    const aiRecommendation = optionalString(input.recommendation);
    const comparison = compareEvaluatorCalibration({
      referenceCriteria,
      aiCriteria,
      humanRecommendation: calibrationCase.human_recommendation ? String(calibrationCase.human_recommendation) : null,
      aiRecommendation: aiRecommendation ?? null,
      tolerance: Number(calibrationCase.tolerance ?? 10),
      ...(input.lowConfidenceThreshold !== undefined
        ? { lowConfidenceThreshold: numberBetween(input.lowConfidenceThreshold, "lowConfidenceThreshold", 0, 1) }
        : {}),
    });
    const provider = optionalString(input.provider);
    const model = optionalString(input.model);
    const promptVersion = optionalString(input.promptVersion);
    const aiEvaluationId = optionalString(input.aiEvaluationId);
    const normalized = {
      referenceReviewId: String(calibrationCase.reference_review_id),
      evaluatorVersion,
      aiCriteria,
      aiRecommendation: aiRecommendation ?? null,
      provider: provider ?? null,
      model: model ?? null,
      promptVersion: promptVersion ?? null,
      aiEvaluationId: aiEvaluationId ?? null,
    };
    const inputFingerprint = fingerprint(normalized);
    const validationReport = {
      missingCriterionKeys: comparison.missingCriterionKeys,
      extraCriterionKeys: comparison.extraCriterionKeys,
      humanReferenceFrozen: true,
      decisionAuthority: "human",
      calibrationOnly: true,
    };

    const rows = await this.database.sql`
      INSERT INTO evaluator_calibration_runs (
        organization_id, calibration_case_id, evaluator_version, criterion_results,
        recommendation, mean_absolute_score_delta, recommendation_agreement,
        within_tolerance, notes, reference_review_id, ai_evaluation_id,
        idempotency_key, input_fingerprint, provider, model, prompt_version,
        criterion_comparisons, reference_criterion_count, matched_criterion_count,
        coverage_rate, root_mean_squared_score_delta, max_absolute_score_delta,
        mean_signed_score_delta, within_tolerance_rate, evidence_agreement_rate,
        low_confidence_rate, false_reject, false_promotion, case_pass,
        validation_report, created_by_user_id
      ) VALUES (
        ${organizationId}::uuid,
        ${caseId}::uuid,
        ${evaluatorVersion},
        ${this.database.sql.json(aiCriteria as never)},
        ${aiRecommendation ?? null},
        ${comparison.meanAbsoluteScoreDelta},
        ${comparison.recommendationAgreement},
        ${comparison.withinToleranceRate === 1 && comparison.coverageRate === 1},
        ${optionalString(input.notes) ?? null},
        ${String(calibrationCase.reference_review_id)}::uuid,
        ${aiEvaluationId ?? null}::uuid,
        ${idempotencyKey},
        ${inputFingerprint},
        ${provider ?? null},
        ${model ?? null},
        ${promptVersion ?? null},
        ${this.database.sql.json(comparison.criterionComparisons as never)},
        ${comparison.referenceCriterionCount},
        ${comparison.matchedCriterionCount},
        ${comparison.coverageRate},
        ${comparison.rootMeanSquaredScoreDelta},
        ${comparison.maxAbsoluteScoreDelta},
        ${comparison.meanSignedScoreDelta},
        ${comparison.withinToleranceRate},
        ${comparison.evidenceAgreementRate},
        ${comparison.lowConfidenceRate},
        ${comparison.falseReject},
        ${comparison.falsePromotion},
        ${comparison.casePass},
        ${this.database.sql.json(validationReport as never)},
        ${userId}::uuid
      )
      ON CONFLICT (organization_id, calibration_case_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL
      DO NOTHING
      RETURNING id::text
    `;

    if (!rows[0]) {
      const existing = await this.database.sql`
        SELECT id::text, input_fingerprint
        FROM evaluator_calibration_runs
        WHERE organization_id = ${organizationId}::uuid
          AND calibration_case_id = ${caseId}::uuid
          AND idempotency_key = ${idempotencyKey}
        LIMIT 1
      `;
      if (!existing[0]) throw new Error("Unable to resolve calibration idempotent replay");
      if (String(existing[0].input_fingerprint) !== inputFingerprint) {
        throw new BadRequestException("Calibration idempotency key was already used with different input");
      }
      return { ...(await this.getRun(String(existing[0].id))), idempotentReplay: true };
    }
    return { ...(await this.getRun(String(rows[0].id))), idempotentReplay: false };
  }

  async getRun(runId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      SELECT r.id::text, r.calibration_case_id::text, c.dataset_id::text,
             r.reference_review_id::text, r.ai_evaluation_id::text, r.evaluator_version,
             r.criterion_results, r.criterion_comparisons, r.recommendation,
             r.mean_absolute_score_delta, r.root_mean_squared_score_delta,
             r.max_absolute_score_delta, r.mean_signed_score_delta,
             r.reference_criterion_count, r.matched_criterion_count, r.coverage_rate,
             r.within_tolerance_rate, r.recommendation_agreement,
             r.evidence_agreement_rate, r.low_confidence_rate,
             r.false_reject, r.false_promotion, r.case_pass,
             r.provider, r.model, r.prompt_version, r.input_fingerprint,
             r.validation_report, r.created_at
      FROM evaluator_calibration_runs r
      JOIN evaluator_calibration_cases c
        ON c.organization_id = r.organization_id AND c.id = r.calibration_case_id
      WHERE r.organization_id = ${organizationId}::uuid AND r.id = ${runId}::uuid
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) throw new NotFoundException("Calibration run not found");
    return {
      id: String(row.id),
      caseId: String(row.calibration_case_id),
      datasetId: String(row.dataset_id),
      referenceReviewId: String(row.reference_review_id),
      ...(row.ai_evaluation_id ? { aiEvaluationId: String(row.ai_evaluation_id) } : {}),
      evaluatorVersion: String(row.evaluator_version),
      criterionResults: row.criterion_results,
      criterionComparisons: row.criterion_comparisons,
      ...(row.recommendation ? { recommendation: String(row.recommendation) } : {}),
      meanAbsoluteScoreDelta: Number(row.mean_absolute_score_delta),
      rootMeanSquaredScoreDelta: Number(row.root_mean_squared_score_delta),
      maxAbsoluteScoreDelta: Number(row.max_absolute_score_delta),
      meanSignedScoreDelta: Number(row.mean_signed_score_delta),
      referenceCriterionCount: Number(row.reference_criterion_count),
      matchedCriterionCount: Number(row.matched_criterion_count),
      coverageRate: Number(row.coverage_rate),
      withinToleranceRate: Number(row.within_tolerance_rate),
      recommendationAgreement: row.recommendation_agreement === null ? null : Boolean(row.recommendation_agreement),
      evidenceAgreementRate: rowNumber(row.evidence_agreement_rate),
      lowConfidenceRate: Number(row.low_confidence_rate),
      falseReject: Boolean(row.false_reject),
      falsePromotion: Boolean(row.false_promotion),
      casePass: Boolean(row.case_pass),
      provenance: {
        ...(row.provider ? { provider: String(row.provider) } : {}),
        ...(row.model ? { model: String(row.model) } : {}),
        ...(row.prompt_version ? { promptVersion: String(row.prompt_version) } : {}),
        inputFingerprint: String(row.input_fingerprint),
      },
      validation: row.validation_report,
      createdAt: new Date(String(row.created_at)).toISOString(),
    };
  }

  async summary(datasetId: string, evaluatorVersion: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const version = evaluatorVersion.trim();
    if (!version) throw new BadRequestException("evaluatorVersion is required");
    const aggregateRows = await this.database.sql`
      SELECT count(*)::int AS run_count,
             COALESCE(sum(reference_criterion_count), 0)::int AS reference_criterion_count,
             COALESCE(sum(matched_criterion_count), 0)::int AS matched_criterion_count,
             CASE WHEN COALESCE(sum(reference_criterion_count), 0) = 0 THEN 0
               ELSE sum(matched_criterion_count)::numeric / sum(reference_criterion_count) END AS coverage_rate,
             CASE WHEN COALESCE(sum(reference_criterion_count), 0) = 0 THEN NULL
               ELSE sum(mean_absolute_score_delta * reference_criterion_count)::numeric / sum(reference_criterion_count) END AS mean_absolute_score_delta,
             CASE WHEN COALESCE(sum(reference_criterion_count), 0) = 0 THEN 0
               ELSE sum(within_tolerance_rate * reference_criterion_count)::numeric / sum(reference_criterion_count) END AS within_tolerance_rate,
             avg((recommendation_agreement::int)::numeric) FILTER (WHERE recommendation_agreement IS NOT NULL)
               AS recommendation_agreement_rate,
             avg((false_reject::int)::numeric) AS false_reject_rate,
             avg((false_promotion::int)::numeric) AS false_promotion_rate,
             avg(evidence_agreement_rate) FILTER (WHERE evidence_agreement_rate IS NOT NULL) AS evidence_agreement_rate,
             CASE WHEN COALESCE(sum(matched_criterion_count), 0) = 0 THEN 0
               ELSE sum(low_confidence_rate * matched_criterion_count)::numeric / sum(matched_criterion_count) END AS low_confidence_rate
      FROM evaluator_calibration_runs r
      JOIN evaluator_calibration_cases c
        ON c.organization_id = r.organization_id AND c.id = r.calibration_case_id
      WHERE r.organization_id = ${organizationId}::uuid
        AND c.dataset_id = ${datasetId}::uuid
        AND r.evaluator_version = ${version}
    `;
    const row = aggregateRows[0];
    const slices = await this.database.sql`
      SELECT COALESCE(c.job_family, 'unspecified') AS job_family,
             COALESCE(c.language, 'unspecified') AS language,
             COALESCE(c.interview_type, 'unspecified') AS interview_type,
             count(*)::int AS run_count,
             avg(r.mean_absolute_score_delta) AS mean_absolute_score_delta,
             avg(r.coverage_rate) AS coverage_rate,
             avg((r.false_reject::int)::numeric) AS false_reject_rate,
             avg((r.false_promotion::int)::numeric) AS false_promotion_rate
      FROM evaluator_calibration_runs r
      JOIN evaluator_calibration_cases c
        ON c.organization_id = r.organization_id AND c.id = r.calibration_case_id
      WHERE r.organization_id = ${organizationId}::uuid
        AND c.dataset_id = ${datasetId}::uuid
        AND r.evaluator_version = ${version}
      GROUP BY c.job_family, c.language, c.interview_type
      ORDER BY c.job_family, c.language, c.interview_type
    `;
    return {
      datasetId,
      evaluatorVersion: version,
      runCount: Number(row?.run_count ?? 0),
      referenceCriterionCount: Number(row?.reference_criterion_count ?? 0),
      matchedCriterionCount: Number(row?.matched_criterion_count ?? 0),
      coverageRate: Number(row?.coverage_rate ?? 0),
      meanAbsoluteScoreDelta: rowNumber(row?.mean_absolute_score_delta),
      withinToleranceRate: Number(row?.within_tolerance_rate ?? 0),
      recommendationAgreementRate: rowNumber(row?.recommendation_agreement_rate),
      falseRejectRate: Number(row?.false_reject_rate ?? 0),
      falsePromotionRate: Number(row?.false_promotion_rate ?? 0),
      evidenceAgreementRate: rowNumber(row?.evidence_agreement_rate),
      lowConfidenceRate: Number(row?.low_confidence_rate ?? 0),
      slices: slices.map((slice) => ({
        jobFamily: String(slice.job_family),
        language: String(slice.language),
        interviewType: String(slice.interview_type),
        runCount: Number(slice.run_count),
        meanAbsoluteScoreDelta: rowNumber(slice.mean_absolute_score_delta),
        coverageRate: Number(slice.coverage_rate ?? 0),
        falseRejectRate: Number(slice.false_reject_rate ?? 0),
        falsePromotionRate: Number(slice.false_promotion_rate ?? 0),
      })),
    };
  }

  async gate(datasetId: string, evaluatorVersion: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const datasets = await this.database.sql`
      SELECT status, thresholds, threshold_policy_version
      FROM evaluator_calibration_datasets
      WHERE organization_id = ${organizationId}::uuid AND id = ${datasetId}::uuid
      LIMIT 1
    `;
    const dataset = datasets[0];
    if (!dataset) throw new NotFoundException("Calibration dataset not found");
    const thresholds = gateThresholds(dataset.thresholds);
    const summary = await this.summary(datasetId, evaluatorVersion);
    const aggregate: CalibrationGateAggregate = {
      runCount: summary.runCount,
      coverageRate: summary.coverageRate,
      meanAbsoluteScoreDelta: summary.meanAbsoluteScoreDelta,
      withinToleranceRate: summary.withinToleranceRate,
      recommendationAgreementRate: summary.recommendationAgreementRate,
      falseRejectRate: summary.falseRejectRate,
      falsePromotionRate: summary.falsePromotionRate,
      evidenceAgreementRate: summary.evidenceAgreementRate,
    };
    if (String(dataset.status) !== "locked") {
      return {
        status: "not_ready" as const,
        reasons: ["dataset_not_locked"],
        thresholds,
        aggregate,
        thresholdPolicyVersion: String(dataset.threshold_policy_version),
        releaseAuthority: "none",
      };
    }
    const evaluation = evaluateCalibrationGate(aggregate, thresholds);
    return {
      ...evaluation,
      thresholdPolicyVersion: String(dataset.threshold_policy_version),
      releaseAuthority: "none",
      note: "Passing this calibration gate does not approve autonomous interviewing or final hiring decisions.",
    };
  }

  private datasetRow(row: Record<string, unknown> | undefined) {
    if (!row) throw new Error("Calibration dataset write returned no row");
    return {
      id: String(row.id),
      datasetKey: String(row.dataset_key),
      version: String(row.version),
      name: String(row.name),
      ...(row.description ? { description: String(row.description) } : {}),
      status: String(row.status),
      thresholds: row.thresholds,
      thresholdPolicyVersion: String(row.threshold_policy_version),
      ...(row.locked_at ? { lockedAt: new Date(String(row.locked_at)).toISOString() } : {}),
      createdAt: new Date(String(row.created_at)).toISOString(),
      updatedAt: new Date(String(row.updated_at)).toISOString(),
    };
  }

  private caseRow(row: Record<string, unknown> | undefined) {
    if (!row) throw new Error("Calibration case write returned no row");
    return {
      id: String(row.id),
      datasetId: String(row.dataset_id),
      caseKey: String(row.case_key),
      rubricVersionId: String(row.rubric_version_id),
      name: String(row.name),
      tolerance: Number(row.tolerance),
      ...(row.language ? { language: String(row.language) } : {}),
      ...(row.job_family ? { jobFamily: String(row.job_family) } : {}),
      ...(row.interview_type ? { interviewType: String(row.interview_type) } : {}),
      active: Boolean(row.active),
      ...(row.reference_review_id ? { referenceReviewId: String(row.reference_review_id) } : {}),
      createdAt: new Date(String(row.created_at)).toISOString(),
    };
  }

  private humanReviewRow(row: Record<string, unknown> | undefined) {
    if (!row) throw new Error("Calibration human review write returned no row");
    return {
      id: String(row.id),
      caseId: String(row.calibration_case_id),
      reviewVersion: Number(row.review_version),
      ...(row.reviewer_user_id ? { reviewerUserId: String(row.reviewer_user_id) } : {}),
      ...(row.reviewer_reference ? { reviewerReference: String(row.reviewer_reference) } : {}),
      status: String(row.status),
      criterionResults: row.criterion_results,
      ...(row.recommendation ? { recommendation: String(row.recommendation) } : {}),
      ...(row.overall_score !== null && row.overall_score !== undefined ? { overallScore: Number(row.overall_score) } : {}),
      ...(row.confidence !== null && row.confidence !== undefined ? { confidence: Number(row.confidence) } : {}),
      isReference: Boolean(row.is_reference),
      createdAt: new Date(String(row.created_at)).toISOString(),
    };
  }
}

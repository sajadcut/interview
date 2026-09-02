import { z } from "zod";
import {
  calculateEvidenceBackedScore,
  type ScoreResult,
} from "../recruiting/score-engine";

export const INTERVIEW_EVALUATOR_INPUT_SCHEMA = "interview-evaluator-input-v1" as const;
export const INTERVIEW_EVALUATOR_DRAFT_SCHEMA = "interview-evaluator-draft-v1" as const;
export const INTERVIEW_EVALUATOR_OUTPUT_SCHEMA = "interview-evaluator-output-v1" as const;
export const EVALUATOR_CONFIDENCE_ALGORITHM = "conservative-min-signal-v1" as const;
export const DEFAULT_LOW_CONFIDENCE_THRESHOLD = 0.65;

export type EvaluatorRecommendation =
  | "strong_recommend"
  | "review"
  | "not_recommended"
  | "insufficient_evidence";

export interface EvaluatorCriterionInput {
  id: string;
  criterionKey: string;
  label: string;
  description: string | null;
  weight: number;
  required: boolean;
  evidencePolicy: Record<string, unknown>;
  displayOrder: number;
}

export interface EvaluatorTranscriptInput {
  id: string;
  speaker: "candidate" | "interviewer" | "system";
  startMs: number;
  endMs: number;
  text: string;
  isFinal: true;
  sttConfidence?: number;
}

export interface EvaluatorEvidenceInput {
  id: string;
  criterionId: string | null;
  turnId: string | null;
  transcriptSegmentIds: string[];
  summary: string;
  confidence?: number;
}

export interface InterviewEvaluatorInput {
  schemaVersion: typeof INTERVIEW_EVALUATOR_INPUT_SCHEMA;
  sessionId: string;
  applicationId: string;
  sessionStatus: string;
  rubricVersionId: string;
  planVersion: number;
  evaluatorVersion: string;
  criteria: EvaluatorCriterionInput[];
  transcript: EvaluatorTranscriptInput[];
  evidence: EvaluatorEvidenceInput[];
  boundaries: {
    evidenceOnly: true;
    unsupportedInference: "insufficient_evidence";
    recommendationIsDecisionSupport: true;
    finalHiringAuthority: "human";
  };
}

const criterionDraftSchema = z
  .object({
    criterionId: z.string().uuid(),
    score: z.number().finite().min(0).max(100),
    rationale: z.string().trim().min(3).max(4000),
    evidenceIds: z.array(z.string().uuid()).min(1).max(100),
    confidence: z.number().finite().min(0).max(1).optional(),
  })
  .strict();

const evaluatorDraftSchema = z
  .object({
    schemaVersion: z.literal(INTERVIEW_EVALUATOR_DRAFT_SCHEMA),
    idempotencyKey: z.string().trim().min(1).max(200),
    evaluatorVersion: z.string().trim().min(1).max(120),
    criterionResults: z.array(criterionDraftSchema).min(1).max(200),
    providerRecommendation: z
      .enum(["strong_recommend", "review", "not_recommended", "insufficient_evidence"])
      .optional(),
    provenance: z
      .object({
        provider: z.string().trim().min(1).max(80),
        model: z.string().trim().min(1).max(160).optional(),
        promptVersion: z.string().trim().min(1).max(120),
        traceReference: z.string().trim().min(1).max(512).optional(),
        calibrationReference: z.string().trim().min(1).max(512).optional(),
        inputReferences: z.record(z.string(), z.unknown()).optional(),
      })
      .strict(),
  })
  .strict();

export type InterviewEvaluatorDraft = z.infer<typeof evaluatorDraftSchema>;

export interface EvaluationIssue {
  code: string;
  message: string;
  criterionId?: string;
  evidenceId?: string;
}

export interface ValidatedCriterionResult {
  criterionId: string;
  criterionKey: string;
  label: string;
  weight: number;
  required: boolean;
  status: "scored" | "insufficient_evidence";
  score: number | null;
  confidence: number;
  confidenceAlgorithm: typeof EVALUATOR_CONFIDENCE_ALGORITHM;
  evidenceIds: string[];
  rationale: string | null;
}

export interface InterviewEvaluatorOutput {
  schemaVersion: typeof INTERVIEW_EVALUATOR_OUTPUT_SCHEMA;
  sessionId: string;
  applicationId: string;
  rubricVersionId: string;
  evaluatorVersion: string;
  status: "validated" | "low_confidence" | "insufficient_evidence";
  criterionResults: ValidatedCriterionResult[];
  overallScore: number | null;
  recommendation: EvaluatorRecommendation;
  providerRecommendation?: EvaluatorRecommendation;
  overallConfidence: number;
  confidenceAlgorithm: typeof EVALUATOR_CONFIDENCE_ALGORITHM;
  evidenceComplete: boolean;
  requiresHumanReview: true;
  reviewReasons: string[];
  scoringAlgorithmVersion: "weighted-evidence-v1";
  validation: {
    valid: true;
    errors: [];
    warnings: EvaluationIssue[];
    missingCriterionIds: string[];
    missingRequiredCriterionIds: string[];
    criterionCoverage: number;
    requiredCriterionCoverage: number;
  };
  provenance: InterviewEvaluatorDraft["provenance"];
  boundaries: InterviewEvaluatorInput["boundaries"];
}

export class InterviewEvaluationValidationError extends Error {
  readonly issues: EvaluationIssue[];

  constructor(issues: EvaluationIssue[]) {
    super(issues.map((issue) => issue.message).join("; "));
    this.name = "InterviewEvaluationValidationError";
    this.issues = issues;
  }
}

function round(value: number, places = 4): number {
  const multiplier = 10 ** places;
  return Math.round(value * multiplier) / multiplier;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function parseInterviewEvaluatorDraft(value: unknown): InterviewEvaluatorDraft {
  const parsed = evaluatorDraftSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new InterviewEvaluationValidationError(
    parsed.error.issues.map((issue) => ({
      code: "invalid_draft_shape",
      message: `${issue.path.join(".") || "draft"}: ${issue.message}`,
    })),
  );
}

function confidenceForCriterion(input: {
  draftConfidence?: number;
  evidence: EvaluatorEvidenceInput[];
  transcript: EvaluatorTranscriptInput[];
}): { confidence: number; measured: boolean } {
  const signals: number[] = [];
  if (input.draftConfidence !== undefined) signals.push(input.draftConfidence);
  for (const evidence of input.evidence) {
    if (evidence.confidence !== undefined) signals.push(evidence.confidence);
  }
  const referencedSegments = new Set(input.evidence.flatMap((item) => item.transcriptSegmentIds));
  for (const segment of input.transcript) {
    if (
      referencedSegments.has(segment.id) &&
      segment.speaker === "candidate" &&
      segment.sttConfidence !== undefined
    ) {
      signals.push(segment.sttConfidence);
    }
  }

  if (signals.length === 0) return { confidence: 0.5, measured: false };
  return { confidence: round(Math.min(...signals)), measured: true };
}

function recommendationOf(score: ScoreResult): EvaluatorRecommendation {
  return score.recommendation;
}

export function evaluateInterviewDraft(
  input: InterviewEvaluatorInput,
  draft: InterviewEvaluatorDraft,
  options: { lowConfidenceThreshold?: number } = {},
): InterviewEvaluatorOutput {
  const threshold = options.lowConfidenceThreshold ?? DEFAULT_LOW_CONFIDENCE_THRESHOLD;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error("lowConfidenceThreshold must be between 0 and 1");
  }
  if (input.schemaVersion !== INTERVIEW_EVALUATOR_INPUT_SCHEMA) {
    throw new InterviewEvaluationValidationError([
      { code: "unsupported_input_schema", message: `Unsupported evaluator input schema ${input.schemaVersion}` },
    ]);
  }
  if (draft.evaluatorVersion !== input.evaluatorVersion) {
    throw new InterviewEvaluationValidationError([
      {
        code: "evaluator_version_mismatch",
        message: `Evaluator version ${draft.evaluatorVersion} does not match release-unit version ${input.evaluatorVersion}`,
      },
    ]);
  }
  if (input.criteria.length === 0) {
    throw new InterviewEvaluationValidationError([
      { code: "empty_rubric", message: "Evaluator input must contain at least one rubric criterion" },
    ]);
  }

  const errors: EvaluationIssue[] = [];
  const warnings: EvaluationIssue[] = [];
  const criterionById = new Map(input.criteria.map((criterion) => [criterion.id, criterion]));
  const evidenceById = new Map(input.evidence.map((evidence) => [evidence.id, evidence]));
  const transcriptById = new Map(input.transcript.map((segment) => [segment.id, segment]));
  const draftByCriterion = new Map<string, InterviewEvaluatorDraft["criterionResults"][number]>();

  for (const result of draft.criterionResults) {
    if (draftByCriterion.has(result.criterionId)) {
      errors.push({
        code: "duplicate_criterion_result",
        message: `Criterion ${result.criterionId} appears more than once in evaluator output`,
        criterionId: result.criterionId,
      });
      continue;
    }
    draftByCriterion.set(result.criterionId, result);
    const criterion = criterionById.get(result.criterionId);
    if (!criterion) {
      errors.push({
        code: "unknown_criterion",
        message: `Criterion ${result.criterionId} is not part of the interview rubric`,
        criterionId: result.criterionId,
      });
      continue;
    }

    const evidenceIds = unique(result.evidenceIds);
    if (evidenceIds.length !== result.evidenceIds.length) {
      warnings.push({
        code: "duplicate_evidence_reference",
        message: `Criterion ${criterion.criterionKey} repeated one or more evidence references`,
        criterionId: criterion.id,
      });
    }

    let hasCandidateTranscript = false;
    for (const evidenceId of evidenceIds) {
      const evidence = evidenceById.get(evidenceId);
      if (!evidence) {
        errors.push({
          code: "unknown_evidence",
          message: `Evidence ${evidenceId} does not belong to the evaluator input`,
          criterionId: criterion.id,
          evidenceId,
        });
        continue;
      }
      if (evidence.criterionId && evidence.criterionId !== criterion.id) {
        errors.push({
          code: "cross_criterion_evidence",
          message: `Evidence ${evidenceId} belongs to another rubric criterion`,
          criterionId: criterion.id,
          evidenceId,
        });
      }
      if (evidence.transcriptSegmentIds.length === 0) {
        errors.push({
          code: "unanchored_evidence",
          message: `Evidence ${evidenceId} has no finalized transcript anchor`,
          criterionId: criterion.id,
          evidenceId,
        });
      }
      for (const segmentId of evidence.transcriptSegmentIds) {
        const segment = transcriptById.get(segmentId);
        if (!segment) {
          errors.push({
            code: "unknown_transcript_reference",
            message: `Evidence ${evidenceId} references transcript segment ${segmentId} outside the finalized evaluator input`,
            criterionId: criterion.id,
            evidenceId,
          });
          continue;
        }
        if (segment.speaker === "candidate") hasCandidateTranscript = true;
      }
    }
    if (!hasCandidateTranscript) {
      errors.push({
        code: "no_candidate_evidence",
        message: `Criterion ${criterion.criterionKey} is scored without candidate-authored transcript evidence`,
        criterionId: criterion.id,
      });
    }
  }

  if (errors.length) throw new InterviewEvaluationValidationError(errors);

  const missingCriterionIds = input.criteria
    .filter((criterion) => !draftByCriterion.has(criterion.id))
    .map((criterion) => criterion.id);
  const missingRequiredCriterionIds = input.criteria
    .filter((criterion) => criterion.required && !draftByCriterion.has(criterion.id))
    .map((criterion) => criterion.id);

  const criterionResults: ValidatedCriterionResult[] = input.criteria.map((criterion) => {
    const result = draftByCriterion.get(criterion.id);
    if (!result) {
      return {
        criterionId: criterion.id,
        criterionKey: criterion.criterionKey,
        label: criterion.label,
        weight: criterion.weight,
        required: criterion.required,
        status: "insufficient_evidence",
        score: null,
        confidence: 0,
        confidenceAlgorithm: EVALUATOR_CONFIDENCE_ALGORITHM,
        evidenceIds: [],
        rationale: null,
      };
    }
    const evidence = unique(result.evidenceIds).map((id) => evidenceById.get(id)!);
    const confidence = confidenceForCriterion({
      ...(result.confidence !== undefined ? { draftConfidence: result.confidence } : {}),
      evidence,
      transcript: input.transcript,
    });
    if (!confidence.measured) {
      warnings.push({
        code: "confidence_unmeasured",
        message: `Criterion ${criterion.criterionKey} has no provider, evidence, or STT confidence signal; conservative fallback applied`,
        criterionId: criterion.id,
      });
    }
    if (confidence.confidence < threshold) {
      warnings.push({
        code: "low_criterion_confidence",
        message: `Criterion ${criterion.criterionKey} confidence ${confidence.confidence} is below ${threshold}`,
        criterionId: criterion.id,
      });
    }
    return {
      criterionId: criterion.id,
      criterionKey: criterion.criterionKey,
      label: criterion.label,
      weight: criterion.weight,
      required: criterion.required,
      status: "scored",
      score: result.score,
      confidence: confidence.confidence,
      confidenceAlgorithm: EVALUATOR_CONFIDENCE_ALGORITHM,
      evidenceIds: unique(result.evidenceIds),
      rationale: result.rationale,
    };
  });

  const score = calculateEvidenceBackedScore(
    criterionResults.map((result) => ({
      criterionId: result.criterionId,
      weight: result.weight,
      score: result.score ?? 0,
      evidenceIds: result.evidenceIds,
    })),
  );
  const recommendation = recommendationOf(score);
  if (draft.providerRecommendation && draft.providerRecommendation !== recommendation) {
    warnings.push({
      code: "provider_recommendation_disagrees",
      message: `Provider recommendation ${draft.providerRecommendation} differs from deterministic recommendation ${recommendation}; provider recommendation was not used as final scoring authority`,
    });
  }

  const totalWeight = criterionResults.reduce((sum, result) => sum + result.weight, 0);
  const overallConfidence = round(
    criterionResults.reduce((sum, result) => sum + result.confidence * result.weight, 0) /
      totalWeight,
  );
  const evidenceComplete = score.status === "complete" && missingCriterionIds.length === 0;
  const reviewReasons = ["human_final_authority"];
  if (!evidenceComplete) reviewReasons.push("insufficient_evidence");
  if (overallConfidence < threshold) reviewReasons.push("low_confidence");
  if (warnings.some((warning) => warning.code === "provider_recommendation_disagrees")) {
    reviewReasons.push("provider_algorithm_disagreement");
  }

  const status = !evidenceComplete
    ? "insufficient_evidence"
    : overallConfidence < threshold
      ? "low_confidence"
      : "validated";
  const criterionCoverage = round(
    criterionResults.filter((result) => result.status === "scored").length / criterionResults.length,
  );
  const required = criterionResults.filter((result) => result.required);
  const requiredCriterionCoverage = required.length
    ? round(required.filter((result) => result.status === "scored").length / required.length)
    : 1;

  return {
    schemaVersion: INTERVIEW_EVALUATOR_OUTPUT_SCHEMA,
    sessionId: input.sessionId,
    applicationId: input.applicationId,
    rubricVersionId: input.rubricVersionId,
    evaluatorVersion: input.evaluatorVersion,
    status,
    criterionResults,
    overallScore: score.overallScore,
    recommendation,
    ...(draft.providerRecommendation ? { providerRecommendation: draft.providerRecommendation } : {}),
    overallConfidence,
    confidenceAlgorithm: EVALUATOR_CONFIDENCE_ALGORITHM,
    evidenceComplete,
    requiresHumanReview: true,
    reviewReasons: unique(reviewReasons),
    scoringAlgorithmVersion: score.algorithmVersion,
    validation: {
      valid: true,
      errors: [],
      warnings,
      missingCriterionIds,
      missingRequiredCriterionIds,
      criterionCoverage,
      requiredCriterionCoverage,
    },
    provenance: draft.provenance,
    boundaries: input.boundaries,
  };
}

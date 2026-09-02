import type { InterviewEvaluatorOutput } from "./interview-evaluator";

export const SHADOW_POLICY_VERSION = "shadow-evaluation-v1" as const;
export const DEFAULT_SHADOW_LOW_CONFIDENCE_THRESHOLD = 0.65;

export type ShadowHumanRecommendation =
  | "strong_recommend"
  | "review"
  | "not_recommended"
  | "insufficient_evidence";

export interface ShadowHumanCriterionResult {
  criterionKey: string;
  score: number;
  evidenceRefs?: string[];
}

export interface ShadowHumanOutcome {
  recommendation: ShadowHumanRecommendation;
  overallScore?: number;
  criterionResults: ShadowHumanCriterionResult[];
}

export interface ShadowCriterionComparison {
  criterionKey: string;
  aiScore: number | null;
  humanScore: number;
  scoreDelta: number | null;
  absoluteScoreDelta: number | null;
  aiConfidence: number;
  evidenceAgreementRate: number | null;
}

export interface ShadowComparisonResult {
  policyVersion: typeof SHADOW_POLICY_VERSION;
  criterionComparisons: ShadowCriterionComparison[];
  referenceCriterionCount: number;
  matchedCriterionCount: number;
  coverageRate: number;
  meanAbsoluteScoreDelta: number | null;
  rootMeanSquaredScoreDelta: number | null;
  maxAbsoluteScoreDelta: number | null;
  meanSignedScoreDelta: number | null;
  recommendationAgreement: boolean;
  overallScoreDelta: number | null;
  falseReject: boolean;
  falsePromotion: boolean;
  lowConfidence: boolean;
  requiresRootCauseReview: boolean;
}

function round(value: number, places = 4): number {
  const multiplier = 10 ** places;
  return Math.round(value * multiplier) / multiplier;
}

function jaccard(left: string[], right: string[]): number | null {
  if (left.length === 0 && right.length === 0) return null;
  const a = new Set(left);
  const b = new Set(right);
  const union = new Set([...a, ...b]);
  if (union.size === 0) return null;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  return round(intersection / union.size);
}

function validateHumanOutcome(outcome: ShadowHumanOutcome): void {
  if (outcome.criterionResults.length === 0) {
    throw new Error("Shadow human outcome requires at least one criterion result");
  }
  const keys = new Set<string>();
  for (const result of outcome.criterionResults) {
    if (!result.criterionKey.trim()) throw new Error("Shadow human criterion key is required");
    if (keys.has(result.criterionKey)) {
      throw new Error(`Duplicate shadow human criterion ${result.criterionKey}`);
    }
    keys.add(result.criterionKey);
    if (!Number.isFinite(result.score) || result.score < 0 || result.score > 100) {
      throw new Error(`Shadow human criterion ${result.criterionKey} score must be between 0 and 100`);
    }
  }
  if (
    outcome.overallScore !== undefined &&
    (!Number.isFinite(outcome.overallScore) || outcome.overallScore < 0 || outcome.overallScore > 100)
  ) {
    throw new Error("Shadow human overall score must be between 0 and 100");
  }
}

export function compareShadowEvaluation(
  ai: InterviewEvaluatorOutput,
  human: ShadowHumanOutcome,
  options: { lowConfidenceThreshold?: number } = {},
): ShadowComparisonResult {
  validateHumanOutcome(human);
  const lowConfidenceThreshold =
    options.lowConfidenceThreshold ?? DEFAULT_SHADOW_LOW_CONFIDENCE_THRESHOLD;
  if (
    !Number.isFinite(lowConfidenceThreshold) ||
    lowConfidenceThreshold < 0 ||
    lowConfidenceThreshold > 1
  ) {
    throw new Error("lowConfidenceThreshold must be between 0 and 1");
  }

  const aiByKey = new Map(ai.criterionResults.map((result) => [result.criterionKey, result]));
  const comparisons: ShadowCriterionComparison[] = human.criterionResults.map((reference) => {
    const candidate = aiByKey.get(reference.criterionKey);
    const aiScore = candidate?.status === "scored" ? candidate.score : null;
    const scoreDelta = aiScore === null || aiScore === undefined ? null : round(aiScore - reference.score);
    return {
      criterionKey: reference.criterionKey,
      aiScore: aiScore ?? null,
      humanScore: reference.score,
      scoreDelta,
      absoluteScoreDelta: scoreDelta === null ? null : round(Math.abs(scoreDelta)),
      aiConfidence: candidate?.confidence ?? 0,
      evidenceAgreementRate: candidate
        ? jaccard(candidate.evidenceIds, reference.evidenceRefs ?? [])
        : null,
    };
  });

  const matched = comparisons.filter((item) => item.scoreDelta !== null);
  const signed = matched.map((item) => item.scoreDelta as number);
  const absolute = matched.map((item) => item.absoluteScoreDelta as number);
  const meanAbsoluteScoreDelta = absolute.length
    ? round(absolute.reduce((sum, value) => sum + value, 0) / absolute.length)
    : null;
  const rootMeanSquaredScoreDelta = signed.length
    ? round(Math.sqrt(signed.reduce((sum, value) => sum + value * value, 0) / signed.length))
    : null;
  const maxAbsoluteScoreDelta = absolute.length ? round(Math.max(...absolute)) : null;
  const meanSignedScoreDelta = signed.length
    ? round(signed.reduce((sum, value) => sum + value, 0) / signed.length)
    : null;
  const recommendationAgreement = ai.recommendation === human.recommendation;
  const falseReject = ai.recommendation === "not_recommended" && human.recommendation === "strong_recommend";
  const falsePromotion = ai.recommendation === "strong_recommend" && human.recommendation === "not_recommended";
  const lowConfidence =
    ai.status === "low_confidence" ||
    ai.status === "insufficient_evidence" ||
    ai.overallConfidence < lowConfidenceThreshold;
  const overallScoreDelta =
    ai.overallScore !== null && human.overallScore !== undefined
      ? round(ai.overallScore - human.overallScore)
      : null;
  const coverageRate = round(matched.length / human.criterionResults.length);

  return {
    policyVersion: SHADOW_POLICY_VERSION,
    criterionComparisons: comparisons,
    referenceCriterionCount: human.criterionResults.length,
    matchedCriterionCount: matched.length,
    coverageRate,
    meanAbsoluteScoreDelta,
    rootMeanSquaredScoreDelta,
    maxAbsoluteScoreDelta,
    meanSignedScoreDelta,
    recommendationAgreement,
    overallScoreDelta,
    falseReject,
    falsePromotion,
    lowConfidence,
    requiresRootCauseReview:
      !recommendationAgreement ||
      falseReject ||
      falsePromotion ||
      lowConfidence ||
      coverageRate < 1,
  };
}

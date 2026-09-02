export type CalibrationGateStatus = "not_ready" | "ready_for_validation" | "passed" | "failed";

export interface CalibrationCriterionValue {
  criterionKey: string;
  score: number;
  confidence?: number;
  evidenceRefs?: string[];
}

export interface CalibrationComparisonInput {
  referenceCriteria: CalibrationCriterionValue[];
  aiCriteria: CalibrationCriterionValue[];
  humanRecommendation?: string | null;
  aiRecommendation?: string | null;
  tolerance: number;
  lowConfidenceThreshold?: number;
}

export interface CalibrationCriterionComparison {
  criterionKey: string;
  referenceScore: number;
  aiScore: number | null;
  signedDelta: number | null;
  absoluteDelta: number;
  withinTolerance: boolean;
  evidenceAgreement: number | null;
  aiConfidence: number | null;
  lowConfidence: boolean;
}

export interface CalibrationComparisonResult {
  criterionComparisons: CalibrationCriterionComparison[];
  referenceCriterionCount: number;
  matchedCriterionCount: number;
  coverageRate: number;
  meanAbsoluteScoreDelta: number;
  rootMeanSquaredScoreDelta: number;
  maxAbsoluteScoreDelta: number;
  meanSignedScoreDelta: number;
  withinToleranceRate: number;
  evidenceAgreementRate: number | null;
  lowConfidenceRate: number;
  missingCriterionKeys: string[];
  extraCriterionKeys: string[];
  recommendationAgreement: boolean | null;
  falseReject: boolean;
  falsePromotion: boolean;
  casePass: boolean;
}

export interface CalibrationGateThresholds {
  minimumCaseCount: number;
  minimumCoverageRate: number;
  maximumMeanAbsoluteScoreDelta: number;
  minimumWithinToleranceRate: number;
  minimumRecommendationAgreementRate: number;
  maximumFalseRejectRate: number;
  maximumFalsePromotionRate: number;
  minimumEvidenceAgreementRate?: number;
}

export interface CalibrationGateAggregate {
  runCount: number;
  coverageRate: number;
  meanAbsoluteScoreDelta: number | null;
  withinToleranceRate: number;
  recommendationAgreementRate: number | null;
  falseRejectRate: number;
  falsePromotionRate: number;
  evidenceAgreementRate: number | null;
}

export interface CalibrationGateEvaluation {
  status: CalibrationGateStatus;
  reasons: string[];
  thresholds: CalibrationGateThresholds;
  aggregate: CalibrationGateAggregate;
}

const round = (value: number, digits = 4): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

function validateCriterionValues(values: CalibrationCriterionValue[], label: string): void {
  const keys = new Set<string>();
  for (const value of values) {
    const key = value.criterionKey.trim();
    if (!key) throw new Error(`${label} criterionKey is required`);
    if (keys.has(key)) throw new Error(`${label} contains duplicate criterion ${key}`);
    keys.add(key);
    if (!Number.isFinite(value.score) || value.score < 0 || value.score > 100) {
      throw new Error(`${label} criterion ${key} score must be between 0 and 100`);
    }
    if (
      value.confidence !== undefined &&
      (!Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1)
    ) {
      throw new Error(`${label} criterion ${key} confidence must be between 0 and 1`);
    }
  }
}

function jaccard(reference: string[] | undefined, actual: string[] | undefined): number | null {
  const referenceSet = new Set((reference ?? []).map((value) => value.trim()).filter(Boolean));
  if (referenceSet.size === 0) return null;
  const actualSet = new Set((actual ?? []).map((value) => value.trim()).filter(Boolean));
  const union = new Set([...referenceSet, ...actualSet]);
  if (union.size === 0) return 1;
  let intersection = 0;
  for (const value of referenceSet) if (actualSet.has(value)) intersection += 1;
  return round(intersection / union.size);
}

function decisionBand(value: string | null | undefined): "positive" | "negative" | "insufficient" | "unknown" {
  switch (value?.trim()) {
    case "strong_recommend":
    case "review":
      return "positive";
    case "not_recommended":
      return "negative";
    case "insufficient_evidence":
      return "insufficient";
    default:
      return "unknown";
  }
}

export function compareEvaluatorCalibration(input: CalibrationComparisonInput): CalibrationComparisonResult {
  if (!input.referenceCriteria.length) throw new Error("At least one human reference criterion is required");
  validateCriterionValues(input.referenceCriteria, "Human reference");
  validateCriterionValues(input.aiCriteria, "AI result");
  if (!Number.isFinite(input.tolerance) || input.tolerance < 0 || input.tolerance > 100) {
    throw new Error("Calibration tolerance must be between 0 and 100");
  }
  const lowConfidenceThreshold = input.lowConfidenceThreshold ?? 0.6;
  if (!Number.isFinite(lowConfidenceThreshold) || lowConfidenceThreshold < 0 || lowConfidenceThreshold > 1) {
    throw new Error("Low-confidence threshold must be between 0 and 1");
  }

  const aiByKey = new Map(input.aiCriteria.map((criterion) => [criterion.criterionKey.trim(), criterion]));
  const referenceKeys = new Set(input.referenceCriteria.map((criterion) => criterion.criterionKey.trim()));
  const missingCriterionKeys: string[] = [];
  const signedMatched: number[] = [];
  const evidenceAgreements: number[] = [];
  let matchedCriterionCount = 0;
  let withinToleranceCount = 0;
  let lowConfidenceCount = 0;

  const criterionComparisons = input.referenceCriteria.map((reference): CalibrationCriterionComparison => {
    const criterionKey = reference.criterionKey.trim();
    const actual = aiByKey.get(criterionKey);
    if (!actual) {
      missingCriterionKeys.push(criterionKey);
      return {
        criterionKey,
        referenceScore: reference.score,
        aiScore: null,
        signedDelta: null,
        absoluteDelta: 100,
        withinTolerance: false,
        evidenceAgreement: null,
        aiConfidence: null,
        lowConfidence: true,
      };
    }
    matchedCriterionCount += 1;
    const signedDelta = actual.score - reference.score;
    const absoluteDelta = Math.abs(signedDelta);
    signedMatched.push(signedDelta);
    if (absoluteDelta <= input.tolerance) withinToleranceCount += 1;
    const evidenceAgreement = jaccard(reference.evidenceRefs, actual.evidenceRefs);
    if (evidenceAgreement !== null) evidenceAgreements.push(evidenceAgreement);
    const aiConfidence = actual.confidence ?? null;
    const lowConfidence = aiConfidence !== null && aiConfidence < lowConfidenceThreshold;
    if (lowConfidence) lowConfidenceCount += 1;
    return {
      criterionKey,
      referenceScore: reference.score,
      aiScore: actual.score,
      signedDelta: round(signedDelta),
      absoluteDelta: round(absoluteDelta),
      withinTolerance: absoluteDelta <= input.tolerance,
      evidenceAgreement,
      aiConfidence,
      lowConfidence,
    };
  });

  const extraCriterionKeys = input.aiCriteria
    .map((criterion) => criterion.criterionKey.trim())
    .filter((key) => !referenceKeys.has(key));
  const referenceCriterionCount = input.referenceCriteria.length;
  const coverageRate = matchedCriterionCount / referenceCriterionCount;
  const absoluteDeltas = criterionComparisons.map((criterion) => criterion.absoluteDelta);
  const meanAbsoluteScoreDelta = absoluteDeltas.reduce((sum, delta) => sum + delta, 0) / referenceCriterionCount;
  const rootMeanSquaredScoreDelta = Math.sqrt(
    absoluteDeltas.reduce((sum, delta) => sum + delta ** 2, 0) / referenceCriterionCount,
  );
  const maxAbsoluteScoreDelta = Math.max(...absoluteDeltas);
  const meanSignedScoreDelta = signedMatched.length
    ? signedMatched.reduce((sum, delta) => sum + delta, 0) / signedMatched.length
    : 0;
  const withinToleranceRate = withinToleranceCount / referenceCriterionCount;
  const evidenceAgreementRate = evidenceAgreements.length
    ? evidenceAgreements.reduce((sum, value) => sum + value, 0) / evidenceAgreements.length
    : null;
  const lowConfidenceRate = matchedCriterionCount ? lowConfidenceCount / matchedCriterionCount : 1;
  const humanBand = decisionBand(input.humanRecommendation);
  const aiBand = decisionBand(input.aiRecommendation);
  const recommendationAgreement =
    humanBand === "unknown" || aiBand === "unknown"
      ? null
      : input.humanRecommendation?.trim() === input.aiRecommendation?.trim();
  const falseReject = humanBand === "positive" && aiBand === "negative";
  const falsePromotion = humanBand === "negative" && aiBand === "positive";
  const casePass =
    coverageRate === 1 &&
    meanAbsoluteScoreDelta <= input.tolerance &&
    withinToleranceRate === 1 &&
    !falseReject &&
    !falsePromotion &&
    recommendationAgreement !== false;

  return {
    criterionComparisons,
    referenceCriterionCount,
    matchedCriterionCount,
    coverageRate: round(coverageRate),
    meanAbsoluteScoreDelta: round(meanAbsoluteScoreDelta),
    rootMeanSquaredScoreDelta: round(rootMeanSquaredScoreDelta),
    maxAbsoluteScoreDelta: round(maxAbsoluteScoreDelta),
    meanSignedScoreDelta: round(meanSignedScoreDelta),
    withinToleranceRate: round(withinToleranceRate),
    evidenceAgreementRate: evidenceAgreementRate === null ? null : round(evidenceAgreementRate),
    lowConfidenceRate: round(lowConfidenceRate),
    missingCriterionKeys,
    extraCriterionKeys,
    recommendationAgreement,
    falseReject,
    falsePromotion,
    casePass,
  };
}

export function evaluateCalibrationGate(
  aggregate: CalibrationGateAggregate,
  thresholds: CalibrationGateThresholds,
): CalibrationGateEvaluation {
  if (!Number.isInteger(thresholds.minimumCaseCount) || thresholds.minimumCaseCount <= 0) {
    throw new Error("minimumCaseCount must be a positive integer");
  }
  const reasons: string[] = [];
  if (aggregate.runCount < thresholds.minimumCaseCount) {
    reasons.push(`sample_count:${aggregate.runCount}/${thresholds.minimumCaseCount}`);
    return { status: "not_ready", reasons, thresholds, aggregate };
  }
  if (aggregate.coverageRate < thresholds.minimumCoverageRate) reasons.push("coverage_below_threshold");
  if (
    aggregate.meanAbsoluteScoreDelta === null ||
    aggregate.meanAbsoluteScoreDelta > thresholds.maximumMeanAbsoluteScoreDelta
  ) reasons.push("mean_absolute_delta_above_threshold");
  if (aggregate.withinToleranceRate < thresholds.minimumWithinToleranceRate) {
    reasons.push("within_tolerance_rate_below_threshold");
  }
  if (
    aggregate.recommendationAgreementRate === null ||
    aggregate.recommendationAgreementRate < thresholds.minimumRecommendationAgreementRate
  ) reasons.push("recommendation_agreement_below_threshold");
  if (aggregate.falseRejectRate > thresholds.maximumFalseRejectRate) reasons.push("false_reject_rate_above_threshold");
  if (aggregate.falsePromotionRate > thresholds.maximumFalsePromotionRate) reasons.push("false_promotion_rate_above_threshold");
  if (
    thresholds.minimumEvidenceAgreementRate !== undefined &&
    (aggregate.evidenceAgreementRate === null || aggregate.evidenceAgreementRate < thresholds.minimumEvidenceAgreementRate)
  ) reasons.push("evidence_agreement_below_threshold");
  return {
    status: reasons.length ? "failed" : "passed",
    reasons,
    thresholds,
    aggregate,
  };
}

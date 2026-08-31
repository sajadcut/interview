export interface CriterionScoreInput {
  criterionId: string;
  weight: number;
  score: number;
  evidenceIds: string[];
}

export interface ScoreThresholds {
  strongRecommend: number;
  review: number;
}

export interface CompleteScoreResult {
  status: "complete";
  overallScore: number;
  recommendation: "strong_recommend" | "review" | "not_recommended";
  algorithmVersion: "weighted-evidence-v1";
}

export interface IncompleteScoreResult {
  status: "incomplete";
  overallScore: null;
  recommendation: "insufficient_evidence";
  missingEvidenceCriterionIds: string[];
  algorithmVersion: "weighted-evidence-v1";
}

export type ScoreResult = CompleteScoreResult | IncompleteScoreResult;

const defaultThresholds: ScoreThresholds = {
  strongRecommend: 85,
  review: 70,
};

function roundTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

export function calculateEvidenceBackedScore(
  criteria: CriterionScoreInput[],
  thresholds: ScoreThresholds = defaultThresholds,
): ScoreResult {
  if (!criteria.length) throw new Error("At least one rubric criterion is required");
  if (thresholds.strongRecommend <= thresholds.review) {
    throw new Error("strongRecommend threshold must be greater than review threshold");
  }

  for (const criterion of criteria) {
    if (!Number.isFinite(criterion.weight) || criterion.weight <= 0) {
      throw new Error(`Criterion ${criterion.criterionId} has an invalid weight`);
    }
    if (!Number.isFinite(criterion.score) || criterion.score < 0 || criterion.score > 100) {
      throw new Error(`Criterion ${criterion.criterionId} has a score outside 0..100`);
    }
  }

  const missingEvidenceCriterionIds = criteria
    .filter((criterion) => criterion.evidenceIds.length === 0)
    .map((criterion) => criterion.criterionId);

  if (missingEvidenceCriterionIds.length) {
    return {
      status: "incomplete",
      overallScore: null,
      recommendation: "insufficient_evidence",
      missingEvidenceCriterionIds,
      algorithmVersion: "weighted-evidence-v1",
    };
  }

  const totalWeight = criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  const weightedScore = criteria.reduce(
    (sum, criterion) => sum + criterion.score * criterion.weight,
    0,
  );
  const overallScore = roundTwo(weightedScore / totalWeight);

  return {
    status: "complete",
    overallScore,
    recommendation:
      overallScore >= thresholds.strongRecommend
        ? "strong_recommend"
        : overallScore >= thresholds.review
          ? "review"
          : "not_recommended",
    algorithmVersion: "weighted-evidence-v1",
  };
}

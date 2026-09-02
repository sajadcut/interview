import assert from "node:assert/strict";
import test from "node:test";
import type { InterviewEvaluatorOutput } from "./interview-evaluator";
import { compareShadowEvaluation } from "./evaluator-shadow-testing";

function output(overrides: Partial<InterviewEvaluatorOutput> = {}): InterviewEvaluatorOutput {
  return {
    schemaVersion: "interview-evaluator-output-v1",
    sessionId: "00000000-0000-4000-8000-000000000001",
    applicationId: "00000000-0000-4000-8000-000000000002",
    rubricVersionId: "00000000-0000-4000-8000-000000000003",
    evaluatorVersion: "eval-v1",
    status: "validated",
    criterionResults: [
      {
        criterionId: "00000000-0000-4000-8000-000000000004",
        criterionKey: "architecture",
        label: "Architecture",
        weight: 1,
        required: true,
        status: "scored",
        score: 82,
        confidence: 0.9,
        confidenceAlgorithm: "conservative-min-signal-v1",
        evidenceIds: ["00000000-0000-4000-8000-000000000005"],
        rationale: "Grounded evidence",
      },
      {
        criterionId: "00000000-0000-4000-8000-000000000006",
        criterionKey: "debugging",
        label: "Debugging",
        weight: 1,
        required: true,
        status: "scored",
        score: 70,
        confidence: 0.8,
        confidenceAlgorithm: "conservative-min-signal-v1",
        evidenceIds: ["00000000-0000-4000-8000-000000000007"],
        rationale: "Grounded evidence",
      },
    ],
    overallScore: 76,
    recommendation: "review",
    overallConfidence: 0.8,
    confidenceAlgorithm: "conservative-min-signal-v1",
    evidenceComplete: true,
    requiresHumanReview: true,
    reviewReasons: ["Human review remains mandatory"],
    scoringAlgorithmVersion: "weighted-evidence-v1",
    validation: {
      valid: true,
      errors: [],
      warnings: [],
      missingCriterionIds: [],
      missingRequiredCriterionIds: [],
      criterionCoverage: 1,
      requiredCriterionCoverage: 1,
    },
    provenance: {
      provider: "fixture",
      promptVersion: "shadow-test-v1",
    },
    boundaries: {
      evidenceOnly: true,
      unsupportedInference: "insufficient_evidence",
      recommendationIsDecisionSupport: true,
      finalHiringAuthority: "human",
    },
    ...overrides,
  };
}

test("shadow comparison measures score, evidence and recommendation agreement", () => {
  const result = compareShadowEvaluation(output(), {
    recommendation: "review",
    overallScore: 74,
    criterionResults: [
      {
        criterionKey: "architecture",
        score: 80,
        evidenceRefs: ["00000000-0000-4000-8000-000000000005"],
      },
      {
        criterionKey: "debugging",
        score: 68,
        evidenceRefs: ["00000000-0000-4000-8000-000000000007"],
      },
    ],
  });

  assert.equal(result.coverageRate, 1);
  assert.equal(result.meanAbsoluteScoreDelta, 2);
  assert.equal(result.rootMeanSquaredScoreDelta, 2);
  assert.equal(result.maxAbsoluteScoreDelta, 2);
  assert.equal(result.meanSignedScoreDelta, 2);
  assert.equal(result.overallScoreDelta, 2);
  assert.equal(result.recommendationAgreement, true);
  assert.equal(result.falseReject, false);
  assert.equal(result.falsePromotion, false);
  assert.equal(result.lowConfidence, false);
  assert.equal(result.requiresRootCauseReview, false);
  assert.deepEqual(result.criterionComparisons.map((item) => item.evidenceAgreementRate), [1, 1]);
});

test("shadow comparison flags false rejection and low confidence for root-cause review", () => {
  const result = compareShadowEvaluation(
    output({
      recommendation: "not_recommended",
      status: "low_confidence",
      overallConfidence: 0.4,
      overallScore: 45,
    }),
    {
      recommendation: "strong_recommend",
      overallScore: 84,
      criterionResults: [{ criterionKey: "architecture", score: 85 }],
    },
  );

  assert.equal(result.falseReject, true);
  assert.equal(result.falsePromotion, false);
  assert.equal(result.lowConfidence, true);
  assert.equal(result.recommendationAgreement, false);
  assert.equal(result.requiresRootCauseReview, true);
});

test("shadow comparison reports missing AI criterion coverage instead of inventing a score", () => {
  const result = compareShadowEvaluation(
    output({ criterionResults: output().criterionResults.slice(0, 1) }),
    {
      recommendation: "review",
      criterionResults: [
        { criterionKey: "architecture", score: 80 },
        { criterionKey: "debugging", score: 70 },
      ],
    },
  );

  assert.equal(result.referenceCriterionCount, 2);
  assert.equal(result.matchedCriterionCount, 1);
  assert.equal(result.coverageRate, 0.5);
  assert.equal(result.criterionComparisons[1]?.aiScore, null);
  assert.equal(result.requiresRootCauseReview, true);
});

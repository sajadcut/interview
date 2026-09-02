import assert from "node:assert/strict";
import test from "node:test";
import { compareEvaluatorCalibration, evaluateCalibrationGate } from "./evaluator-calibration";

test("calibration comparison reports criterion deltas, evidence agreement and missing coverage", () => {
  const result = compareEvaluatorCalibration({
    referenceCriteria: [
      { criterionKey: "architecture", score: 80, evidenceRefs: ["e1", "e2"] },
      { criterionKey: "debugging", score: 60, evidenceRefs: ["e3"] },
    ],
    aiCriteria: [
      { criterionKey: "architecture", score: 90, confidence: 0.9, evidenceRefs: ["e1"] },
      { criterionKey: "extra", score: 70, confidence: 0.8 },
    ],
    humanRecommendation: "review",
    aiRecommendation: "review",
    tolerance: 10,
  });

  assert.equal(result.referenceCriterionCount, 2);
  assert.equal(result.matchedCriterionCount, 1);
  assert.equal(result.coverageRate, 0.5);
  assert.equal(result.meanAbsoluteScoreDelta, 55);
  assert.equal(result.rootMeanSquaredScoreDelta, 71.0634);
  assert.equal(result.maxAbsoluteScoreDelta, 100);
  assert.equal(result.meanSignedScoreDelta, 10);
  assert.equal(result.withinToleranceRate, 0.5);
  assert.equal(result.evidenceAgreementRate, 0.5);
  assert.deepEqual(result.missingCriterionKeys, ["debugging"]);
  assert.deepEqual(result.extraCriterionKeys, ["extra"]);
  assert.equal(result.recommendationAgreement, true);
  assert.equal(result.casePass, false);
});

test("calibration comparison detects false rejection and conservative low confidence", () => {
  const result = compareEvaluatorCalibration({
    referenceCriteria: [{ criterionKey: "delivery", score: 82, evidenceRefs: ["a"] }],
    aiCriteria: [{ criterionKey: "delivery", score: 45, confidence: 0.45, evidenceRefs: ["a"] }],
    humanRecommendation: "strong_recommend",
    aiRecommendation: "not_recommended",
    tolerance: 10,
    lowConfidenceThreshold: 0.6,
  });
  assert.equal(result.falseReject, true);
  assert.equal(result.falsePromotion, false);
  assert.equal(result.lowConfidenceRate, 1);
  assert.equal(result.recommendationAgreement, false);
});

test("calibration comparison detects false promotion", () => {
  const result = compareEvaluatorCalibration({
    referenceCriteria: [{ criterionKey: "security", score: 30 }],
    aiCriteria: [{ criterionKey: "security", score: 85, confidence: 0.9 }],
    humanRecommendation: "not_recommended",
    aiRecommendation: "review",
    tolerance: 10,
  });
  assert.equal(result.falseReject, false);
  assert.equal(result.falsePromotion, true);
});

test("calibration gate stays not ready until the required sample count exists", () => {
  const gate = evaluateCalibrationGate(
    {
      runCount: 4,
      coverageRate: 1,
      meanAbsoluteScoreDelta: 2,
      withinToleranceRate: 1,
      recommendationAgreementRate: 1,
      falseRejectRate: 0,
      falsePromotionRate: 0,
      evidenceAgreementRate: 1,
    },
    {
      minimumCaseCount: 5,
      minimumCoverageRate: 0.95,
      maximumMeanAbsoluteScoreDelta: 10,
      minimumWithinToleranceRate: 0.9,
      minimumRecommendationAgreementRate: 0.9,
      maximumFalseRejectRate: 0.05,
      maximumFalsePromotionRate: 0.05,
      minimumEvidenceAgreementRate: 0.8,
    },
  );
  assert.equal(gate.status, "not_ready");
  assert.deepEqual(gate.reasons, ["sample_count:4/5"]);
});

test("calibration gate passes only when every configured threshold passes", () => {
  const thresholds = {
    minimumCaseCount: 5,
    minimumCoverageRate: 0.95,
    maximumMeanAbsoluteScoreDelta: 10,
    minimumWithinToleranceRate: 0.9,
    minimumRecommendationAgreementRate: 0.9,
    maximumFalseRejectRate: 0.05,
    maximumFalsePromotionRate: 0.05,
    minimumEvidenceAgreementRate: 0.8,
  };
  const aggregate = {
    runCount: 10,
    coverageRate: 0.99,
    meanAbsoluteScoreDelta: 6,
    withinToleranceRate: 0.95,
    recommendationAgreementRate: 0.95,
    falseRejectRate: 0.02,
    falsePromotionRate: 0.01,
    evidenceAgreementRate: 0.9,
  };
  assert.equal(evaluateCalibrationGate(aggregate, thresholds).status, "passed");

  const failed = evaluateCalibrationGate({ ...aggregate, falseRejectRate: 0.2 }, thresholds);
  assert.equal(failed.status, "failed");
  assert.ok(failed.reasons.includes("false_reject_rate_above_threshold"));
});

test("calibration comparison rejects duplicate criteria", () => {
  assert.throws(
    () =>
      compareEvaluatorCalibration({
        referenceCriteria: [{ criterionKey: "x", score: 50 }],
        aiCriteria: [
          { criterionKey: "x", score: 50 },
          { criterionKey: "x", score: 55 },
        ],
        tolerance: 10,
      }),
    /duplicate criterion/,
  );
});

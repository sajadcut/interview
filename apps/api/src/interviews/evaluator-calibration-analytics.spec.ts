import assert from "node:assert/strict";
import test from "node:test";
import {
  buildConfidenceCalibration,
  calculateRankingAgreement,
} from "./evaluator-calibration-analytics";

test("ranking analytics report perfect order agreement for monotonic scores", () => {
  const result = calculateRankingAgreement([
    { humanScore: 30, aiScore: 40 },
    { humanScore: 60, aiScore: 65 },
    { humanScore: 90, aiScore: 85 },
  ]);
  assert.equal(result.sampleCount, 3);
  assert.equal(result.spearmanRankingCorrelation, 1);
  assert.ok(result.pearsonScoreCorrelation !== null);
  assert.ok(result.pearsonScoreCorrelation > 0.9);
});

test("ranking analytics handles ties using average ranks", () => {
  const result = calculateRankingAgreement([
    { humanScore: 50, aiScore: 60 },
    { humanScore: 50, aiScore: 60 },
    { humanScore: 80, aiScore: 90 },
  ]);
  assert.equal(result.spearmanRankingCorrelation, 1);
});

test("ranking analytics does not invent correlation from one sample", () => {
  const result = calculateRankingAgreement([{ humanScore: 80, aiScore: 82 }]);
  assert.equal(result.pearsonScoreCorrelation, null);
  assert.equal(result.spearmanRankingCorrelation, null);
});

test("confidence analytics expose observed accuracy and expected calibration error", () => {
  const result = buildConfidenceCalibration([
    { confidence: 0.9, withinTolerance: true },
    { confidence: 0.8, withinTolerance: true },
    { confidence: 0.4, withinTolerance: false },
    { confidence: 0.3, withinTolerance: true },
  ]);
  assert.equal(result.sampleCount, 4);
  assert.equal(result.bucketWidth, 0.2);
  assert.ok(result.buckets.length >= 2);
  assert.ok(result.expectedCalibrationError !== null);
  assert.ok(result.expectedCalibrationError >= 0);
  assert.ok(result.expectedCalibrationError <= 1);
});

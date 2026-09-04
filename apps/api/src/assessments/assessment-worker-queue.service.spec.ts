import assert from "node:assert/strict";
import test from "node:test";
import {
  computeAssessmentRetryDelayMs,
  validateAssessmentWorkerResult,
} from "./assessment-worker-queue.service";

test("assessment retry delay is bounded exponential backoff", () => {
  assert.equal(computeAssessmentRetryDelayMs(1), 1000);
  assert.equal(computeAssessmentRetryDelayMs(2), 2000);
  assert.equal(computeAssessmentRetryDelayMs(99), 60000);
});

test("assessment worker result rejects core execution and invalid counts", () => {
  assert.throws(
    () => validateAssessmentWorkerResult({
      status: "passed",
      passedTests: 1,
      totalTests: 1,
      runnerType: "core-api",
      runnerVersion: "1",
    }),
    /Core API execution is prohibited/,
  );
  assert.throws(
    () => validateAssessmentWorkerResult({
      status: "passed",
      passedTests: 2,
      totalTests: 1,
      runnerType: "container-docker",
      runnerVersion: "1",
    }),
    /test counts are invalid/,
  );
});

test("assessment worker result accepts isolated deterministic scores", () => {
  const result = validateAssessmentWorkerResult({
    status: "failed",
    passedTests: 3,
    totalTests: 4,
    rawScore: 3,
    runnerType: "container-docker",
    runnerVersion: "assessment-worker-v1",
    details: { networkAccess: false },
  });
  assert.equal(result.passedTests, 3);
  assert.equal(result.totalTests, 4);
  assert.equal(result.runnerType, "container-docker");
});

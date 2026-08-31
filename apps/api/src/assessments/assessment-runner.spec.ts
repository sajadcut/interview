import assert from "node:assert/strict";
import test from "node:test";
import { DisabledCoreProcessAssessmentRunner, normalizeAssessmentScore } from "./assessment-runner";

test("core API refuses to execute candidate code", async () => {
  const runner = new DisabledCoreProcessAssessmentRunner();
  await assert.rejects(() => runner.run(), /disabled in the core API/);
});

test("assessment score normalization is deterministic", () => {
  assert.equal(normalizeAssessmentScore(7, 8), 87.5);
});

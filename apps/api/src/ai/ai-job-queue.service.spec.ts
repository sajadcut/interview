import assert from "node:assert/strict";
import test from "node:test";
import { computeRetryDelayMs } from "./ai-job-queue.service";

test("AI job retry backoff doubles by attempt and respects the ceiling", () => {
  assert.equal(computeRetryDelayMs(1, 1000, 60000), 1000);
  assert.equal(computeRetryDelayMs(2, 1000, 60000), 2000);
  assert.equal(computeRetryDelayMs(3, 1000, 60000), 4000);
  assert.equal(computeRetryDelayMs(20, 1000, 60000), 60000);
});

test("AI job retry backoff normalizes unsafe bounds", () => {
  assert.equal(computeRetryDelayMs(0, 1, 1), 100);
  assert.equal(computeRetryDelayMs(2, 500, 100), 500);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  booleanEnvironment,
  integerEnvironment,
  percentile,
  scenarioThresholdFailures,
  summarizeLatencies,
} from "./load-test-lib.mjs";

test("load-test numeric settings are bounded", () => {
  assert.equal(integerEnvironment("50", 10, 1, 40), 40);
  assert.equal(integerEnvironment("n/a", 10, 1, 40), 10);
  assert.equal(integerEnvironment("0", 10, 1, 40), 1);
});

test("load-test booleans are strict and explicit", () => {
  assert.equal(booleanEnvironment("true"), true);
  assert.equal(booleanEnvironment("OFF", true), false);
  assert.equal(booleanEnvironment(undefined, true), true);
  assert.throws(() => booleanEnvironment("maybe"), /Invalid boolean value/);
});

test("percentiles and latency summaries are deterministic", () => {
  assert.equal(percentile([1, 2, 3, 4], 0.95), 4);
  assert.deepEqual(summarizeLatencies([10, 30, 20, 40]), {
    p50: 20,
    p95: 40,
    p99: 40,
    max: 40,
  });
});

test("scenario thresholds fail on latency or errors", () => {
  const result = { errorRate: 0.02, latencyMs: { p95: 501 } };
  const failures = scenarioThresholdFailures(result, { maxErrorRate: 0.01, p95MaxMs: 500 });
  assert.equal(failures.length, 2);
});

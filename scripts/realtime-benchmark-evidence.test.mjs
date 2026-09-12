import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeBenchmark,
  histogramDeltaQuantile,
  parsePrometheus,
  parseSessionResults,
  validateBenchmarkPlan,
} from "./realtime-benchmark-evidence.mjs";

function plan() {
  return {
    schemaVersion: "realtime-benchmark-plan.v1",
    releaseUnit: { jobFamily: "backend", language: "fa-en", interviewType: "technical_screening" },
    minimumCompletedInterviews: 100,
    scenarios: [
      { id: "baseline_fa", minimumCompletedInterviews: 40 },
      { id: "code_switch", minimumCompletedInterviews: 30 },
      { id: "reconnect", minimumCompletedInterviews: 30 },
    ],
    thresholds: { maxE2EP95Seconds: 1.8, maxFailureRate: 0.02, maxAbandonmentRate: 0.02 },
  };
}

function results(count = 100) {
  return Array.from({ length: count }, (_, index) => ({
    schemaVersion: "realtime-benchmark-session.v1",
    runId: `bench-${String(index).padStart(4, "0")}`,
    scenario: index < 40 ? "baseline_fa" : index < 70 ? "code_switch" : "reconnect",
    language: index < 40 ? "fa" : "fa-en",
    status: "completed",
    turnCount: 8,
    reconnectCount: index >= 70 ? 1 : 0,
    failureClass: null,
  }));
}

function metrics({ e2e1 = 0, e2e18 = 0, e2eInf = 0, success = 0, errors = 0, timeouts = 0, whisper1 = 0, whisperInf = 0 } = {}) {
  return `
interview_realtime_turn_duration_seconds_bucket{stage="e2e",le="1"} ${e2e1}
interview_realtime_turn_duration_seconds_bucket{stage="e2e",le="1.8"} ${e2e18}
interview_realtime_turn_duration_seconds_bucket{stage="e2e",le="+Inf"} ${e2eInf}
interview_realtime_whisper_processing_duration_seconds_bucket{le="1"} ${whisper1}
interview_realtime_whisper_processing_duration_seconds_bucket{le="+Inf"} ${whisperInf}
interview_realtime_turns_total{result="success"} ${success}
interview_realtime_turns_total{result="error"} ${errors}
interview_realtime_turns_total{result="timeout"} ${timeouts}
interview_realtime_livekit_reconnects_total{reason="network"} 0
interview_realtime_livekit_reconnects_total{reason="ice"} 0
interview_realtime_livekit_reconnects_total{reason="server"} 0
interview_realtime_livekit_reconnects_total{reason="unknown"} 0
`;
}

test("prometheus parser and histogram delta compute a p95 upper bound", () => {
  const before = parsePrometheus(metrics());
  const after = parsePrometheus(metrics({ e2e1: 90, e2e18: 96, e2eInf: 100 }));
  assert.deepEqual(histogramDeltaQuantile(before, after, "interview_realtime_turn_duration_seconds", { stage: "e2e" }, 0.95), {
    available: true,
    reset: false,
    count: 100,
    upperBound: 1.8,
  });
});

test("session results reject PII-like or undeclared fields", () => {
  const row = JSON.stringify({ ...results(1)[0], candidateEmail: "someone@example.com" });
  assert.throws(() => parseSessionResults(row), /forbidden field candidateEmail/);
});

test("benchmark plan requires at least 100 completed interviews", () => {
  const invalid = plan();
  invalid.minimumCompletedInterviews = 50;
  assert.ok(validateBenchmarkPlan(invalid).some((item) => item.includes("at least 100")));
});

test("representative 100 interview sample plus observed metrics can pass configured thresholds", () => {
  const evidence = analyzeBenchmark({
    plan: plan(),
    results: results(),
    beforeMetricsText: metrics(),
    afterMetricsText: metrics({ e2e1: 90, e2e18: 96, e2eInf: 100, success: 800, whisper1: 760, whisperInf: 800 }),
  });
  assert.equal(evidence.result, "sufficient_sample");
  assert.equal(evidence.productionGatePassed, true);
  assert.equal(evidence.sample.counts.completed, 100);
  assert.equal(evidence.realtime.e2eP95UpperBoundSeconds, 1.8);
});

test("missing approved thresholds never becomes a production gate pass", () => {
  const config = plan();
  config.thresholds = { maxE2EP95Seconds: null, maxFailureRate: null, maxAbandonmentRate: null };
  const evidence = analyzeBenchmark({
    plan: config,
    results: results(),
    beforeMetricsText: metrics(),
    afterMetricsText: metrics({ e2e1: 90, e2e18: 96, e2eInf: 100, success: 800, whisper1: 760, whisperInf: 800 }),
  });
  assert.equal(evidence.result, "sufficient_sample");
  assert.equal(evidence.productionGatePassed, false);
  assert.ok(evidence.thresholdChecks.every((check) => check.status === "info"));
});

test("counter reset fails the benchmark evidence", () => {
  const evidence = analyzeBenchmark({
    plan: plan(),
    results: results(),
    beforeMetricsText: metrics({ e2e1: 100, e2e18: 120, e2eInf: 130, success: 900, whisper1: 100, whisperInf: 130 }),
    afterMetricsText: metrics({ e2e1: 20, e2e18: 30, e2eInf: 40, success: 100, whisper1: 20, whisperInf: 40 }),
  });
  assert.equal(evidence.result, "insufficient_or_invalid_sample");
  assert.equal(evidence.productionGatePassed, false);
});

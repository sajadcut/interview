import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

interface RealtimeMetricContract {
  contractVersion: string;
  namespace: string;
  principles: {
    piiLabelsForbidden: boolean;
    unboundedLabelsForbidden: boolean;
    emitOnlyObservedSeries: boolean;
    gateFE2EP95Seconds: number;
  };
  metrics: Array<{
    name: string;
    type: "counter" | "gauge" | "histogram";
    help: string;
    labels?: Record<string, string[]>;
    buckets?: number[];
    source: string;
    wiring: "wired" | "recorder_contract" | "provider_data_pending";
  }>;
}

function loadContract(): RealtimeMetricContract {
  const candidates = [
    resolve(process.cwd(), "../../contracts/realtime-metrics.v1.json"),
    resolve(process.cwd(), "contracts/realtime-metrics.v1.json"),
  ];
  const path = candidates.find((candidate) => existsSync(candidate));
  if (!path) throw new Error("realtime metrics contract fixture not found");
  return JSON.parse(readFileSync(path, "utf-8")) as RealtimeMetricContract;
}

test("realtime metrics v1 contract is bounded, PII-safe, and internally consistent", () => {
  const contract = loadContract();
  assert.equal(contract.contractVersion, "v1");
  assert.equal(contract.namespace, "interview_realtime");
  assert.equal(contract.principles.piiLabelsForbidden, true);
  assert.equal(contract.principles.unboundedLabelsForbidden, true);
  assert.equal(contract.principles.emitOnlyObservedSeries, true);
  assert.equal(contract.principles.gateFE2EP95Seconds, 1.8);

  const names = contract.metrics.map((metric) => metric.name);
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.length >= 20);
  assert.ok(names.every((name) => /^interview_realtime_[a-z0-9_]+$/.test(name)));

  const forbiddenLabel = /(?:^|_)(?:id|uuid|candidate|organization|org|session|room|token|worker|user|email|name|reference)(?:_|$)/i;
  for (const metric of contract.metrics) {
    assert.ok(metric.help.trim().length > 10, `${metric.name} needs help text`);
    assert.ok(["counter", "gauge", "histogram"].includes(metric.type));
    assert.ok(["wired", "recorder_contract", "provider_data_pending"].includes(metric.wiring));
    for (const [label, allowedValues] of Object.entries(metric.labels ?? {})) {
      assert.doesNotMatch(label, forbiddenLabel, `${metric.name} has a forbidden/high-cardinality label`);
      assert.ok(allowedValues.length > 0 && allowedValues.length <= 16, `${metric.name}.${label} must be bounded`);
      assert.equal(new Set(allowedValues).size, allowedValues.length);
      assert.ok(allowedValues.every((value) => value.length <= 32));
    }
    if (metric.type === "histogram") {
      const buckets = metric.buckets ?? [];
      assert.ok(buckets.length >= 2, `${metric.name} needs histogram buckets`);
      for (let index = 0; index < buckets.length; index += 1) {
        assert.ok(Number.isFinite(buckets[index]) && buckets[index]! >= 0);
        if (index > 0) assert.ok(buckets[index]! > buckets[index - 1]!, `${metric.name} buckets must increase`);
      }
    } else {
      assert.equal(metric.buckets, undefined, `${metric.name} must not define histogram buckets`);
    }
  }
});

test("contract covers LiveKit, whisper.cpp, FFmpeg, and the Gate F E2E latency boundary", () => {
  const contract = loadContract();
  const requiredPrefixes = [
    "interview_realtime_livekit_",
    "interview_realtime_whisper_",
    "interview_realtime_ffmpeg_",
  ];
  for (const prefix of requiredPrefixes) {
    assert.ok(contract.metrics.some((metric) => metric.name.startsWith(prefix)), `${prefix} metrics are missing`);
  }

  const e2e = contract.metrics.find((metric) => metric.name === "interview_realtime_turn_duration_seconds");
  assert.ok(e2e);
  assert.equal(e2e.type, "histogram");
  assert.ok(e2e.labels?.stage?.includes("e2e"));
  assert.ok(e2e.buckets?.includes(contract.principles.gateFE2EP95Seconds));

  const livekitProviderMetrics = contract.metrics.filter(
    (metric) => metric.name.startsWith("interview_realtime_livekit_") && metric.wiring === "provider_data_pending",
  );
  assert.ok(livekitProviderMetrics.length >= 4);

  const whisperWired = contract.metrics.filter(
    (metric) => metric.name.startsWith("interview_realtime_whisper_") && metric.wiring === "wired",
  );
  assert.ok(whisperWired.length >= 4);
});

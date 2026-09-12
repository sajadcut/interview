import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadStagingEnvironment } from "./staging-runtime-preflight.mjs";

const SCHEMA_VERSION = "realtime-benchmark-evidence.v1";
const RESULT_SCHEMA_VERSION = "realtime-benchmark-session.v1";
const DEFAULT_BASELINE = ".local-data/evidence/realtime-benchmark-baseline.json";
const DEFAULT_EVIDENCE = ".local-data/evidence/realtime-benchmark-evidence.json";
const ALLOWED_RESULT_KEYS = new Set([
  "schemaVersion",
  "runId",
  "scenario",
  "language",
  "status",
  "turnCount",
  "reconnectCount",
  "failureClass",
  "startedAt",
  "completedAt",
]);

function pass(id, detail, measurements = {}) {
  return { id, status: "pass", detail, measurements };
}
function fail(id, detail, measurements = {}) {
  return { id, status: "fail", detail, measurements };
}
function info(id, detail, measurements = {}) {
  return { id, status: "info", detail, measurements };
}

function safeUrl(baseUrl, path) {
  const base = String(baseUrl ?? "").trim();
  if (!base) throw new Error("MEDIA_WORKER_BASE_URL is required");
  return new URL(path.replace(/^\//, ""), base.endsWith("/") ? base : `${base}/`).toString();
}

function parseLabels(text) {
  const labels = {};
  const pattern = /([A-Za-z_][A-Za-z0-9_]*)="((?:\\.|[^"])*)"/g;
  for (const match of text.matchAll(pattern)) {
    labels[match[1]] = match[2].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return labels;
}

export function parsePrometheus(text) {
  const samples = [];
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_:][A-Za-z0-9_:]*)(?:\{([^}]*)\})?\s+(-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[+-]?Inf|NaN)$/);
    if (!match) continue;
    const value = Number(match[3]);
    if (!Number.isFinite(value)) continue;
    samples.push({ name: match[1], labels: parseLabels(match[2] ?? ""), value });
  }
  return samples;
}

function labelKey(labels) {
  return Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join(",");
}
function sampleKey(sample) {
  return `${sample.name}|${labelKey(sample.labels)}`;
}
function sampleMap(samples) {
  return new Map(samples.map((sample) => [sampleKey(sample), sample]));
}

export function metricDelta(beforeSamples, afterSamples, name, labels = {}) {
  const before = sampleMap(beforeSamples);
  const after = sampleMap(afterSamples);
  const key = `${name}|${labelKey(labels)}`;
  const left = before.get(key)?.value ?? 0;
  const right = after.get(key)?.value;
  if (right === undefined) return { available: false, reset: false, delta: null };
  if (right < left) return { available: true, reset: true, delta: null };
  return { available: true, reset: false, delta: right - left };
}

function histogramBuckets(samples, metricBase, labels) {
  return samples
    .filter((sample) => sample.name === `${metricBase}_bucket`)
    .filter((sample) => Object.entries(labels).every(([key, value]) => sample.labels[key] === value))
    .map((sample) => ({ le: sample.labels.le === "+Inf" ? Infinity : Number(sample.labels.le), value: sample.value }))
    .filter((item) => Number.isFinite(item.le) || item.le === Infinity)
    .sort((a, b) => a.le - b.le);
}

export function histogramDeltaQuantile(beforeSamples, afterSamples, metricBase, labels, quantile) {
  const before = new Map(histogramBuckets(beforeSamples, metricBase, labels).map((item) => [item.le, item.value]));
  const after = histogramBuckets(afterSamples, metricBase, labels);
  if (!after.length) return { available: false, reset: false, count: 0, upperBound: null };
  const deltas = [];
  for (const bucket of after) {
    const delta = bucket.value - (before.get(bucket.le) ?? 0);
    if (delta < 0) return { available: true, reset: true, count: 0, upperBound: null };
    deltas.push({ le: bucket.le, value: delta });
  }
  const inf = deltas.find((bucket) => bucket.le === Infinity);
  const count = inf?.value ?? deltas.at(-1)?.value ?? 0;
  if (count <= 0) return { available: true, reset: false, count: 0, upperBound: null };
  const target = Math.ceil(count * quantile);
  const bucket = deltas.find((item) => item.value >= target);
  return { available: true, reset: false, count, upperBound: bucket?.le ?? null };
}

export function parseSessionResults(text) {
  const results = [];
  const seen = new Set();
  for (const [index, rawLine] of String(text).split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error(`results line ${index + 1} is not valid JSON`);
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`results line ${index + 1} must be an object`);
    for (const key of Object.keys(value)) {
      if (!ALLOWED_RESULT_KEYS.has(key)) throw new Error(`results line ${index + 1} contains forbidden field ${key}`);
    }
    if (value.schemaVersion !== RESULT_SCHEMA_VERSION) throw new Error(`results line ${index + 1} has an unexpected schemaVersion`);
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(String(value.runId ?? ""))) throw new Error(`results line ${index + 1} has an invalid runId`);
    if (seen.has(value.runId)) throw new Error(`duplicate runId ${value.runId}`);
    seen.add(value.runId);
    if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(String(value.scenario ?? ""))) throw new Error(`results line ${index + 1} has an invalid scenario`);
    if (!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(String(value.language ?? "")) && value.language !== "fa-en") throw new Error(`results line ${index + 1} has an invalid language`);
    if (!["completed", "failed", "abandoned"].includes(value.status)) throw new Error(`results line ${index + 1} has an invalid status`);
    if (!Number.isInteger(value.turnCount) || value.turnCount < 0 || value.turnCount > 1000) throw new Error(`results line ${index + 1} has an invalid turnCount`);
    if (!Number.isInteger(value.reconnectCount) || value.reconnectCount < 0 || value.reconnectCount > 100) throw new Error(`results line ${index + 1} has an invalid reconnectCount`);
    if (value.failureClass != null && !["network", "ice", "server", "provider", "browser", "unknown"].includes(value.failureClass)) {
      throw new Error(`results line ${index + 1} has an invalid failureClass`);
    }
    results.push(value);
  }
  return results;
}

export function validateBenchmarkPlan(plan) {
  const errors = [];
  if (plan?.schemaVersion !== "realtime-benchmark-plan.v1") errors.push("schemaVersion must be realtime-benchmark-plan.v1");
  if (!Number.isInteger(plan?.minimumCompletedInterviews) || plan.minimumCompletedInterviews < 100) errors.push("minimumCompletedInterviews must be at least 100");
  if (!Array.isArray(plan?.scenarios) || !plan.scenarios.length) errors.push("scenarios are required");
  const seen = new Set();
  for (const scenario of plan?.scenarios ?? []) {
    if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(String(scenario?.id ?? ""))) errors.push("every scenario needs a bounded id");
    if (seen.has(scenario?.id)) errors.push(`duplicate scenario ${scenario.id}`);
    seen.add(scenario?.id);
    if (!Number.isInteger(scenario?.minimumCompletedInterviews) || scenario.minimumCompletedInterviews < 1) errors.push(`scenario ${scenario?.id ?? "unknown"} needs a positive minimumCompletedInterviews`);
  }
  const thresholds = plan?.thresholds ?? {};
  for (const key of ["maxE2EP95Seconds", "maxFailureRate", "maxAbandonmentRate"]) {
    const value = thresholds[key];
    if (value != null && (!Number.isFinite(value) || value < 0)) errors.push(`${key} must be null or a non-negative number`);
  }
  return errors;
}

function summarizeResults(results, plan) {
  const counts = { total: results.length, completed: 0, failed: 0, abandoned: 0 };
  const scenarios = {};
  let reconnects = 0;
  let turns = 0;
  for (const result of results) {
    counts[result.status] += 1;
    reconnects += result.reconnectCount;
    turns += result.turnCount;
    const bucket = scenarios[result.scenario] ?? { total: 0, completed: 0, failed: 0, abandoned: 0 };
    bucket.total += 1;
    bucket[result.status] += 1;
    scenarios[result.scenario] = bucket;
  }
  const requiredScenarioIds = new Set(plan.scenarios.map((item) => item.id));
  const unknownScenarios = Object.keys(scenarios).filter((id) => !requiredScenarioIds.has(id));
  return {
    counts,
    scenarios,
    unknownScenarios,
    reconnects,
    turns,
    failureRate: counts.total ? counts.failed / counts.total : 0,
    abandonmentRate: counts.total ? counts.abandoned / counts.total : 0,
  };
}

function evaluateSample(summary, plan) {
  const checks = [];
  checks.push(summary.counts.completed >= plan.minimumCompletedInterviews
    ? pass("sample.completed", `completed interview count satisfies minimum ${plan.minimumCompletedInterviews}`, { completed: summary.counts.completed })
    : fail("sample.completed", `completed interview count is below minimum ${plan.minimumCompletedInterviews}`, { completed: summary.counts.completed }));
  for (const scenario of plan.scenarios) {
    const completed = summary.scenarios[scenario.id]?.completed ?? 0;
    checks.push(completed >= scenario.minimumCompletedInterviews
      ? pass(`scenario.${scenario.id}`, "scenario completion requirement satisfied", { completed, minimum: scenario.minimumCompletedInterviews })
      : fail(`scenario.${scenario.id}`, "scenario completion requirement not satisfied", { completed, minimum: scenario.minimumCompletedInterviews }));
  }
  if (summary.unknownScenarios.length) checks.push(fail("sample.unknown_scenarios", "results contain scenarios not declared in the plan", { count: summary.unknownScenarios.length }));
  else checks.push(pass("sample.unknown_scenarios", "all result scenarios are declared in the benchmark plan", { count: 0 }));
  return checks;
}

function evaluateThreshold(id, value, maximum, unit) {
  if (maximum == null) return info(id, "threshold not approved/configured; production gate cannot pass", { observed: value, maximum: null, unit });
  if (value == null || !Number.isFinite(value)) return fail(id, "required observed metric is unavailable", { observed: null, maximum, unit });
  return value <= maximum
    ? pass(id, "observed value is within the approved threshold", { observed: value, maximum, unit })
    : fail(id, "observed value exceeds the approved threshold", { observed: value, maximum, unit });
}

export function analyzeBenchmark({ plan, results, beforeMetricsText, afterMetricsText }) {
  const planErrors = validateBenchmarkPlan(plan);
  if (planErrors.length) throw new Error(`invalid benchmark plan: ${planErrors.join("; ")}`);
  const before = parsePrometheus(beforeMetricsText);
  const after = parsePrometheus(afterMetricsText);
  const summary = summarizeResults(results, plan);
  const checks = evaluateSample(summary, plan);

  const e2eP95 = histogramDeltaQuantile(before, after, "interview_realtime_turn_duration_seconds", { stage: "e2e" }, 0.95);
  const whisperP95 = histogramDeltaQuantile(before, after, "interview_realtime_whisper_processing_duration_seconds", {}, 0.95);
  const successTurns = metricDelta(before, after, "interview_realtime_turns_total", { result: "success" });
  const errorTurns = metricDelta(before, after, "interview_realtime_turns_total", { result: "error" });
  const timeoutTurns = metricDelta(before, after, "interview_realtime_turns_total", { result: "timeout" });
  const reconnectReasons = ["network", "ice", "server", "unknown"].map((reason) => ({ reason, ...metricDelta(before, after, "interview_realtime_livekit_reconnects_total", { reason }) }));
  const metricState = [e2eP95, whisperP95, successTurns, errorTurns, timeoutTurns, ...reconnectReasons];
  if (metricState.some((item) => item.reset)) checks.push(fail("metrics.counter_reset", "one or more benchmark counters/histograms reset between snapshots"));
  else checks.push(pass("metrics.counter_reset", "no counter reset detected between benchmark snapshots"));
  if (!e2eP95.available || e2eP95.count === 0) checks.push(fail("metrics.e2e_observed", "no observed E2E turn histogram samples were produced during the benchmark"));
  else checks.push(pass("metrics.e2e_observed", "E2E turn histogram contains observed benchmark samples", { turnSamples: e2eP95.count, p95UpperBoundSeconds: e2eP95.upperBound }));
  if (!successTurns.available || (successTurns.delta ?? 0) === 0) checks.push(fail("metrics.turns_observed", "no successful realtime turns were observed during the benchmark"));
  else checks.push(pass("metrics.turns_observed", "successful realtime turns were observed", { successfulTurns: successTurns.delta }));

  const thresholds = plan.thresholds ?? {};
  const thresholdChecks = [
    evaluateThreshold("threshold.e2e_p95", e2eP95.upperBound, thresholds.maxE2EP95Seconds, "seconds"),
    evaluateThreshold("threshold.failure_rate", summary.failureRate, thresholds.maxFailureRate, "ratio"),
    evaluateThreshold("threshold.abandonment_rate", summary.abandonmentRate, thresholds.maxAbandonmentRate, "ratio"),
  ];
  const mandatoryPass = checks.every((check) => check.status === "pass");
  const thresholdsConfigured = thresholdChecks.every((check) => check.status !== "info");
  const thresholdsPass = thresholdChecks.every((check) => check.status === "pass");

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    releaseUnit: plan.releaseUnit ?? null,
    result: mandatoryPass ? "sufficient_sample" : "insufficient_or_invalid_sample",
    productionGatePassed: mandatoryPass && thresholdsConfigured && thresholdsPass,
    sample: {
      ...summary,
      failureRate: Number(summary.failureRate.toFixed(6)),
      abandonmentRate: Number(summary.abandonmentRate.toFixed(6)),
    },
    realtime: {
      e2eP95UpperBoundSeconds: e2eP95.upperBound,
      e2eTurnSamples: e2eP95.count,
      whisperP95UpperBoundSeconds: whisperP95.upperBound,
      whisperSamples: whisperP95.count,
      successfulTurns: successTurns.delta,
      errorTurns: errorTurns.delta,
      timeoutTurns: timeoutTurns.delta,
      reconnects: Object.fromEntries(reconnectReasons.map((item) => [item.reason, item.delta])),
    },
    checks,
    thresholdChecks,
    privacy: {
      resultRowsContainCandidateIdentifiers: false,
      rawAudioPersisted: false,
      transcriptTextPersisted: false,
      metricsContainPerCandidateLabels: false,
    },
  };
}

async function fetchMetrics(env, fetchImpl = fetch, timeoutMs = 10_000) {
  const target = safeUrl(env.MEDIA_WORKER_BASE_URL, "/metrics");
  const response = await fetchImpl(target, { method: "GET", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`media-worker metrics returned HTTP ${response.status}`);
  return response.text();
}

function parseArguments(argv) {
  const options = {
    command: argv[0],
    envFile: process.env.STAGING_ENV_FILE?.trim() || ".env.staging.local",
    baselineFile: DEFAULT_BASELINE,
    planFile: "ops/staging/realtime-benchmark-plan.example.json",
    resultsFile: ".local-data/evidence/realtime-benchmark-sessions.jsonl",
    evidenceFile: DEFAULT_EVIDENCE,
  };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--env") options.envFile = argv[++index];
    else if (argument === "--baseline") options.baselineFile = argv[++index];
    else if (argument === "--plan") options.planFile = argv[++index];
    else if (argument === "--results") options.resultsFile = argv[++index];
    else if (argument === "--evidence") options.evidenceFile = argv[++index];
    else if (argument === "--help") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help || !["start", "finish"].includes(options.command)) {
    console.log("Usage: node scripts/realtime-benchmark-evidence.mjs <start|finish> [--env file] [--baseline file] [--plan file] [--results file] [--evidence file]");
    if (!options.help) process.exitCode = 1;
    return;
  }
  const envPath = resolve(process.cwd(), options.envFile);
  if (!existsSync(envPath)) throw new Error(`staging environment file not found: ${envPath}`);
  const env = loadStagingEnvironment(envPath);
  if (options.command === "start") {
    const metricsText = await fetchMetrics(env);
    const baseline = { schemaVersion: "realtime-benchmark-baseline.v1", capturedAt: new Date().toISOString(), metricsText };
    const output = resolve(process.cwd(), options.baselineFile);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, `${JSON.stringify(baseline)}\n`, "utf8");
    console.log(`Benchmark baseline captured at ${options.baselineFile}`);
    return;
  }
  const baselinePath = resolve(process.cwd(), options.baselineFile);
  const planPath = resolve(process.cwd(), options.planFile);
  const resultsPath = resolve(process.cwd(), options.resultsFile);
  for (const [label, path] of [["baseline", baselinePath], ["plan", planPath], ["results", resultsPath]]) {
    if (!existsSync(path)) throw new Error(`${label} file not found: ${path}`);
  }
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  if (baseline.schemaVersion !== "realtime-benchmark-baseline.v1" || typeof baseline.metricsText !== "string") throw new Error("invalid benchmark baseline file");
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  const results = parseSessionResults(readFileSync(resultsPath, "utf8"));
  const afterMetricsText = await fetchMetrics(env);
  const evidence = analyzeBenchmark({ plan, results, beforeMetricsText: baseline.metricsText, afterMetricsText });
  const output = resolve(process.cwd(), options.evidenceFile);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(`Benchmark evidence written to ${options.evidenceFile}`);
  console.log(`Sample result: ${evidence.result}; productionGatePassed=${evidence.productionGatePassed}`);
  if (evidence.result !== "sufficient_sample") process.exitCode = 1;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) await main();

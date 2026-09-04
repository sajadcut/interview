import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const paths = {
  contract: resolve(root, "contracts/ffmpeg-integration.v1.json"),
  metrics: resolve(root, "contracts/realtime-metrics.v1.json"),
  env: resolve(root, ".env.example"),
  layer: resolve(root, "services/media-worker/ffmpeg_layer.py"),
  server: resolve(root, "services/media-worker/server.py"),
  tests: resolve(root, "services/media-worker/test/test_ffmpeg_layer.py"),
  package: resolve(root, "package.json"),
};

function invariant(condition, message) {
  if (!condition) throw new Error(`FFmpeg integration contract check failed: ${message}`);
}

const [contractText, metricsText, envExample, layerSource, serverSource, testSource, packageText] = await Promise.all([
  readFile(paths.contract, "utf8"),
  readFile(paths.metrics, "utf8"),
  readFile(paths.env, "utf8"),
  readFile(paths.layer, "utf8"),
  readFile(paths.server, "utf8"),
  readFile(paths.tests, "utf8"),
  readFile(paths.package, "utf8"),
]);

const contract = JSON.parse(contractText);
const metrics = JSON.parse(metricsText);
const pkg = JSON.parse(packageText);
const expectedOperations = ["ingest", "transcode", "mux", "segment", "recording_finalize"];

invariant(contract.version === "ffmpeg-integration.v1", "version drift");
invariant(contract.provider === "ffmpeg", "provider drift");
invariant(JSON.stringify(contract.operations) === JSON.stringify(expectedOperations), "operation allowlist drift");
invariant(contract.commandBuilder?.shell === false, "shell execution must remain disabled");
invariant(contract.commandBuilder?.stdin === "disabled", "stdin must remain disabled");
invariant(contract.commandBuilder?.workspaceOnlyPaths === true, "paths must stay workspace-scoped");
invariant(
  JSON.stringify(contract.commandBuilder?.globalArgs) ===
    JSON.stringify(["-hide_banner", "-nostdin", "-loglevel", "error", "-y"]),
  "global argument profile drift",
);
invariant(contract.process?.timeoutSeconds?.min === 0.05, "timeout minimum drift");
invariant(contract.process?.timeoutSeconds?.default === 120, "timeout default drift");
invariant(contract.process?.timeoutSeconds?.max === 600, "timeout maximum drift");
invariant(contract.process?.terminationGraceSeconds?.default === 2, "termination grace drift");
invariant(contract.process?.processGroupIsolation === true, "process group isolation must stay enabled");
invariant(contract.process?.terminateThenKill === true, "terminate-then-kill policy must stay enabled");
invariant(contract.process?.diagnosticMaxBytes === 8192, "diagnostic bound drift");
invariant(contract.cleanup?.temporaryWorkspace === true, "temporary workspace cleanup drift");
invariant(contract.cleanup?.removeOnSuccess === true, "success cleanup drift");
invariant(contract.cleanup?.removeOnFailure === true, "failure cleanup drift");
invariant(contract.cleanup?.doesNotMaskPrimaryError === true, "cleanup must not mask primary failures");
invariant(contract.runtimeEvidence?.contractTestsRequireRealFFmpeg === false, "contract tests must not require FFmpeg");
invariant(contract.runtimeEvidence?.requiresRealFFmpeg === true, "runtime evidence boundary drift");

const expectedErrors = [
  ["invalid_request", "error", false],
  ["executable_not_found", "unavailable", false],
  ["process_start_failed", "unavailable", false],
  ["process_timeout", "timeout", true],
  ["process_cancelled", "cancelled", false],
  ["process_failed", "error", false],
  ["output_missing", "error", false],
  ["output_empty", "error", false],
  ["cleanup_failed", "error", false],
];
invariant(
  JSON.stringify((contract.errors ?? []).map((entry) => [entry.code, entry.result, entry.retryable])) ===
    JSON.stringify(expectedErrors),
  "error taxonomy drift",
);

const jobsMetric = metrics.metrics.find((entry) => entry.name === "interview_realtime_ffmpeg_jobs_total");
const exitMetric = metrics.metrics.find((entry) => entry.name === "interview_realtime_ffmpeg_process_exits_total");
invariant(Boolean(jobsMetric), "FFmpeg jobs metric missing");
invariant(Boolean(exitMetric), "FFmpeg exit metric missing");
invariant(JSON.stringify(jobsMetric.labels?.operation) === JSON.stringify(expectedOperations), "metrics operation allowlist drift");
invariant(
  JSON.stringify(jobsMetric.labels?.result) === JSON.stringify(["success", "error", "timeout", "cancelled", "unavailable"]),
  "metrics result allowlist drift",
);
invariant(
  JSON.stringify(exitMetric.labels?.exit_class) === JSON.stringify(["zero", "nonzero", "signal", "timeout"]),
  "metrics exit-class allowlist drift",
);

for (const variable of [
  "FFMPEG_ENABLED=false",
  "FFMPEG_CLI=ffmpeg",
  "FFMPEG_TIMEOUT_SECONDS=120",
  "FFMPEG_TERMINATION_GRACE_SECONDS=2",
  "FFMPEG_WORK_ROOT=",
]) {
  invariant(envExample.includes(variable), `.env.example is missing ${variable}`);
}

for (const marker of [
  'CONTRACT_VERSION = "ffmpeg-integration.v1"',
  "class FFmpegCommandBuilder",
  "class FFmpegProcessRunner",
  "class FFmpegWorkspace",
  "shell=False",
  "start_new_session",
  "os.killpg",
  "signal.SIGTERM",
  "signal.SIGKILL",
  "TemporaryFile",
  "record_ffmpeg_job",
  "set_ffmpeg_active_processes",
  "DIAGNOSTIC_MAX_BYTES = 8192",
]) {
  invariant(layerSource.includes(marker), `implementation marker missing: ${marker}`);
}

for (const marker of [
  "from ffmpeg_layer import ffmpeg_status",
  'return bool(ffmpeg_status()["ready"])',
  'self.path == "/ffmpeg/health"',
]) {
  invariant(serverSource.includes(marker), `media-worker readiness marker missing: ${marker}`);
}

for (const marker of [
  "sys.executable",
  "process_timeout",
  "process_cancelled",
  "output_missing",
  "output_empty",
  "test_workspace_cleanup_runs_after_success",
]) {
  invariant(testSource.includes(marker), `dependency-free test marker missing: ${marker}`);
}

invariant(pkg.scripts?.["ffmpeg:contract:check"] === "node scripts/check-ffmpeg-integration.mjs", "package script missing");
invariant(pkg.scripts?.["media-worker:test"]?.includes("ffmpeg_layer.py"), "media worker py_compile must include ffmpeg layer");
invariant(pkg.scripts?.test?.includes("ffmpeg:contract:check"), "root test must enforce FFmpeg contract");

console.log("FFmpeg Integration Contract v1 is internally consistent without requiring FFmpeg.");

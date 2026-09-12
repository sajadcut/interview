import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnvText } from "./staging-runtime-preflight.mjs";
import { validateBenchmarkPlan } from "./realtime-benchmark-evidence.mjs";

const root = process.cwd();
const manifestPath = resolve(root, "ops/staging/runtime-manifest.v1.json");
if (!existsSync(manifestPath)) throw new Error("staging runtime manifest is missing");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.schemaVersion !== "staging-runtime-manifest.v1") throw new Error("unexpected staging runtime manifest schemaVersion");

const requiredComponents = new Set(["postgresql", "api", "livekit", "media-worker", "vad-worker", "tts-worker", "ai-interviewer"]);
const componentIds = new Set((manifest.components ?? []).filter((item) => item?.required === true).map((item) => item.id));
for (const id of requiredComponents) if (!componentIds.has(id)) throw new Error(`staging runtime manifest is missing required component ${id}`);

for (const gate of [manifest.gates?.preflight, manifest.gates?.smoke, manifest.gates?.benchmarkEvidence]) {
  if (!gate || !existsSync(resolve(root, gate))) throw new Error(`staging runtime gate is missing: ${gate ?? "undefined"}`);
}
const benchmarkPlanPath = resolve(root, manifest.benchmarkPlanTemplate ?? "");
if (!existsSync(benchmarkPlanPath)) throw new Error("staging benchmark plan template is missing");
const benchmarkPlan = JSON.parse(readFileSync(benchmarkPlanPath, "utf8"));
const benchmarkPlanErrors = validateBenchmarkPlan(benchmarkPlan);
if (benchmarkPlanErrors.length) throw new Error(`staging benchmark plan template is invalid: ${benchmarkPlanErrors.join("; ")}`);
if (benchmarkPlan.thresholds?.maxE2EP95Seconds !== null || benchmarkPlan.thresholds?.maxFailureRate !== null || benchmarkPlan.thresholds?.maxAbandonmentRate !== null) {
  throw new Error("committed benchmark plan template must not pre-approve production thresholds");
}

const envTemplatePath = resolve(root, manifest.environmentTemplate ?? "");
if (!existsSync(envTemplatePath)) throw new Error("staging environment template is missing");
const env = parseEnvText(readFileSync(envTemplatePath, "utf8"));
const requiredEnv = [
  "NODE_ENV", "SUPERVISED_PILOT_ENABLED", "DATABASE_URL", "STAGING_API_BASE_URL", "MEDIA_REALTIME_ENABLED",
  "MEDIA_TRANSPORT_PROVIDER", "LIVEKIT_URL", "LIVEKIT_HEALTH_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "TURN_URLS",
  "MEDIA_WORKER_SHARED_SECRET", "MEDIA_WORKER_BASE_URL", "FFMPEG_ENABLED", "WHISPER_CLI", "WHISPER_MODEL_PATH",
  "STT_PROVIDER", "STT_BASE_URL", "VAD_PROVIDER", "VAD_BASE_URL", "TTS_PROVIDER", "TTS_BASE_URL", "TTS_COMMAND",
  "LLM_PROVIDER", "LLM_MODEL", "LLM_API_KEY", "AI_WORKER_SHARED_SECRET", "AI_INTERVIEWER_BASE_URL"
];
for (const name of requiredEnv) if (!(name in env)) throw new Error(`staging environment template is missing ${name}`);
if (env.NODE_ENV !== "production") throw new Error("staging environment template must use NODE_ENV=production");
if (env.SUPERVISED_PILOT_ENABLED !== "false") throw new Error("staging environment template must keep supervised pilot disabled");
if (env.MEDIA_REALTIME_ENABLED !== "true" || env.MEDIA_TRANSPORT_PROVIDER !== "livekit") throw new Error("staging environment template must enable LiveKit realtime");
if (env.STT_PROVIDER !== "whisper-http" || env.VAD_PROVIDER !== "silero-http" || env.TTS_PROVIDER !== "local-http") throw new Error("staging environment template must select real local speech providers");
if (env.LLM_PROVIDER !== "openai-compatible") throw new Error("staging environment template must select a real LLM provider boundary");
for (const name of ["LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "MEDIA_WORKER_SHARED_SECRET", "LLM_API_KEY", "AI_WORKER_SHARED_SECRET"]) {
  if (!String(env[name] ?? "").includes("REPLACE_ME")) throw new Error(`${name} must remain an explicit placeholder in the committed staging template`);
}
for (const urlName of ["STAGING_API_BASE_URL", "LIVEKIT_HEALTH_URL", "MEDIA_WORKER_BASE_URL", "STT_BASE_URL", "VAD_BASE_URL", "TTS_BASE_URL", "AI_INTERVIEWER_BASE_URL"]) {
  if (!String(env[urlName]).startsWith("https://")) throw new Error(`${urlName} must use https:// in the staging template`);
}
if (!String(env.LIVEKIT_URL).startsWith("wss://")) throw new Error("LIVEKIT_URL must use wss:// in the staging template");
if (!String(env.TURN_URLS).includes("turns:")) throw new Error("TURN_URLS must include a TLS TURN endpoint");

console.log("✓ staging runtime manifest, fail-closed environment template, benchmark plan, and evidence gates are consistent");

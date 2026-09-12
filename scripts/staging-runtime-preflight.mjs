import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const WEAK_SECRETS = new Set([
  "changeme",
  "change_me",
  "replace_me",
  "replace-me",
  "example",
  "secret",
  "password",
  "livekit-secret",
]);

function pass(id, detail) {
  return { id, status: "pass", detail };
}

function fail(id, detail) {
  return { id, status: "fail", detail };
}

export function parseEnvText(text) {
  const parsed = {};
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(separator + 1).trim();
    if (value.length >= 2) {
      const quoted =
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"));
      if (quoted) value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

export function loadStagingEnvironment(filePath, processEnvironment = process.env) {
  const fileEnvironment = existsSync(filePath) ? parseEnvText(readFileSync(filePath, "utf8")) : {};
  return { ...fileEnvironment, ...processEnvironment };
}

function nonEmptyCheck(id, value, label) {
  return String(value ?? "").trim() ? pass(id, `${label} is configured`) : fail(id, `${label} is required`);
}

function exactCheck(id, value, expected, label) {
  return value === expected ? pass(id, `${label}=${expected}`) : fail(id, `${label} must be ${expected}`);
}

function booleanCheck(id, value, expected, label) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return exactCheck(id, normalized, expected ? "true" : "false", label);
}

function urlCheck(id, value, protocols, label) {
  const raw = String(value ?? "").trim();
  if (!raw) return fail(id, `${label} is required`);
  try {
    const parsed = new URL(raw);
    if (!protocols.includes(parsed.protocol)) {
      return fail(id, `${label} must use ${protocols.join(" or ")}`);
    }
    return pass(id, `${label} uses ${parsed.protocol}// transport`);
  } catch {
    return fail(id, `${label} must be a valid URL`);
  }
}

function strongSecretCheck(id, value, label) {
  const raw = String(value ?? "").trim();
  if (!raw) return fail(id, `${label} is required`);
  if (Buffer.byteLength(raw, "utf8") < 32) return fail(id, `${label} must be at least 32 bytes`);
  if (WEAK_SECRETS.has(raw.toLowerCase())) return fail(id, `${label} cannot be a placeholder`);
  return pass(id, `${label} satisfies the production secret policy`);
}

function turnCheck(value) {
  const urls = String(value ?? "")
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (!urls.length) return fail("turn.urls", "TURN_URLS must contain at least one TURN endpoint");
  if (!urls.every((url) => /^turns?:/i.test(url))) {
    return fail("turn.urls", "Every TURN_URLS entry must start with turn: or turns:");
  }
  return pass("turn.urls", `${urls.length} TURN endpoint(s) configured`);
}

export function validateStagingEnvironment(env) {
  return [
    exactCheck("node.env", env.NODE_ENV, "production", "NODE_ENV"),
    booleanCheck("pilot.disabled", env.SUPERVISED_PILOT_ENABLED, false, "SUPERVISED_PILOT_ENABLED"),
    nonEmptyCheck("database.url", env.DATABASE_URL, "DATABASE_URL"),
    booleanCheck("media.enabled", env.MEDIA_REALTIME_ENABLED, true, "MEDIA_REALTIME_ENABLED"),
    exactCheck("livekit.provider", env.MEDIA_TRANSPORT_PROVIDER, "livekit", "MEDIA_TRANSPORT_PROVIDER"),
    urlCheck("livekit.url", env.LIVEKIT_URL, ["wss:"], "LIVEKIT_URL"),
    urlCheck("livekit.health_url", env.LIVEKIT_HEALTH_URL, ["https:"], "LIVEKIT_HEALTH_URL"),
    nonEmptyCheck("livekit.api_key", env.LIVEKIT_API_KEY, "LIVEKIT_API_KEY"),
    strongSecretCheck("livekit.api_secret", env.LIVEKIT_API_SECRET, "LIVEKIT_API_SECRET"),
    turnCheck(env.TURN_URLS),
    strongSecretCheck("media.secret", env.MEDIA_WORKER_SHARED_SECRET, "MEDIA_WORKER_SHARED_SECRET"),
    exactCheck("stt.provider", env.STT_PROVIDER, "whisper-http", "STT_PROVIDER"),
    urlCheck("stt.url", env.STT_BASE_URL, ["https:"], "STT_BASE_URL"),
    booleanCheck("ffmpeg.enabled", env.FFMPEG_ENABLED, true, "FFMPEG_ENABLED"),
    nonEmptyCheck("whisper.cli", env.WHISPER_CLI, "WHISPER_CLI"),
    nonEmptyCheck("whisper.model", env.WHISPER_MODEL_PATH, "WHISPER_MODEL_PATH"),
    exactCheck("vad.provider", env.VAD_PROVIDER, "silero-http", "VAD_PROVIDER"),
    urlCheck("vad.url", env.VAD_BASE_URL, ["http:", "https:"], "VAD_BASE_URL"),
    exactCheck("tts.provider", env.TTS_PROVIDER, "local-http", "TTS_PROVIDER"),
    urlCheck("tts.url", env.TTS_BASE_URL, ["http:", "https:"], "TTS_BASE_URL"),
    nonEmptyCheck("tts.command", env.TTS_COMMAND, "TTS_COMMAND"),
    exactCheck("llm.provider", env.LLM_PROVIDER, "openai-compatible", "LLM_PROVIDER"),
    nonEmptyCheck("llm.model", env.LLM_MODEL, "LLM_MODEL"),
    nonEmptyCheck("llm.api_key", env.LLM_API_KEY, "LLM_API_KEY"),
    strongSecretCheck("ai.secret", env.AI_WORKER_SHARED_SECRET, "AI_WORKER_SHARED_SECRET"),
    urlCheck("ai.interviewer_url", env.AI_INTERVIEWER_BASE_URL, ["http:", "https:"], "AI_INTERVIEWER_BASE_URL"),
  ];
}

function safeTarget(rawUrl, path = "") {
  try {
    const url = new URL(path, rawUrl.endsWith("/") ? rawUrl : `${rawUrl}/`);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "invalid-url";
  }
}

async function probe({ id, baseUrl, path = "", expect, fetchImpl, timeoutMs }) {
  const target = safeTarget(baseUrl, path);
  try {
    const response = await fetchImpl(target, {
      method: "GET",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
    let body = null;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      try {
        body = await response.json();
      } catch {
        return fail(id, `${target} returned invalid JSON`);
      }
    }
    if (!response.ok) return fail(id, `${target} returned HTTP ${response.status}`);
    if (expect && !expect(body)) return fail(id, `${target} did not report the required ready state`);
    return pass(id, `${target} is ready (HTTP ${response.status})`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "probe failed";
    return fail(id, `${target} probe failed: ${message}`);
  }
}

export async function probeStagingRuntime(env, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const apiBase = String(env.STAGING_API_BASE_URL ?? "").trim();
  const mediaBase = String(env.MEDIA_WORKER_BASE_URL ?? "").trim();
  const livekitHealth = String(env.LIVEKIT_HEALTH_URL ?? "").trim();
  const vadBase = String(env.VAD_BASE_URL ?? "").trim();
  const ttsBase = String(env.TTS_BASE_URL ?? "").trim();
  const interviewerBase = String(env.AI_INTERVIEWER_BASE_URL ?? "").trim();

  const missing = [];
  for (const [id, value, label] of [
    ["runtime.api_base", apiBase, "STAGING_API_BASE_URL"],
    ["runtime.media_base", mediaBase, "MEDIA_WORKER_BASE_URL"],
  ]) {
    if (!value) missing.push(fail(id, `${label} is required for runtime probes`));
  }
  if (missing.length) return missing;

  const probes = [
    { id: "runtime.api.health", baseUrl: apiBase, path: "/health", expect: (body) => body?.status === "ok" },
    { id: "runtime.api.ready", baseUrl: apiBase, path: "/health/ready", expect: (body) => body?.status === "ready" },
    { id: "runtime.api.livekit", baseUrl: apiBase, path: "/health/livekit", expect: (body) => body?.ready === true },
    { id: "runtime.api.whisper", baseUrl: apiBase, path: "/health/whisper", expect: (body) => body?.ready === true },
    { id: "runtime.livekit", baseUrl: livekitHealth, path: "/", expect: null },
    { id: "runtime.media", baseUrl: mediaBase, path: "/health", expect: (body) => body?.ready === true },
    { id: "runtime.media.ffmpeg", baseUrl: mediaBase, path: "/ffmpeg/health", expect: (body) => body?.ready === true },
    { id: "runtime.media.stt", baseUrl: mediaBase, path: "/stt/health", expect: (body) => body?.ready === true },
    { id: "runtime.vad", baseUrl: vadBase, path: "/health", expect: (body) => body?.ready === true },
    { id: "runtime.tts", baseUrl: ttsBase, path: "/health", expect: (body) => body?.ready === true },
    { id: "runtime.ai_interviewer", baseUrl: interviewerBase, path: "/health", expect: (body) => body?.ready === true },
  ];

  const results = [];
  for (const item of probes) {
    if (!String(item.baseUrl ?? "").trim()) {
      results.push(fail(item.id, `${item.id} base URL is not configured`));
      continue;
    }
    results.push(await probe({ ...item, fetchImpl, timeoutMs }));
  }
  return results;
}

export function passed(checks) {
  return checks.every((check) => check.status === "pass");
}

export function buildEvidence({ envFile, configurationChecks, runtimeChecks }) {
  return {
    schemaVersion: "staging-runtime-preflight.v1",
    generatedAt: new Date().toISOString(),
    environmentFile: envFile,
    result: passed([...configurationChecks, ...runtimeChecks]) ? "pass" : "fail",
    configurationChecks,
    runtimeChecks,
  };
}

function parseArguments(argv) {
  const options = {
    envFile: process.env.STAGING_ENV_FILE?.trim() || ".env.staging.local",
    evidenceFile: process.env.STAGING_EVIDENCE_FILE?.trim() || ".local-data/evidence/staging-runtime-preflight.json",
    configOnly: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--config-only") options.configOnly = true;
    else if (argument === "--env") options.envFile = argv[++index];
    else if (argument === "--evidence") options.evidenceFile = argv[++index];
    else if (argument === "--help") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function printChecks(title, checks) {
  console.log(`\n${title}`);
  for (const check of checks) {
    console.log(`${check.status === "pass" ? "PASS" : "FAIL"}  ${check.id.padEnd(28)} ${check.detail}`);
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: node scripts/staging-runtime-preflight.mjs [--env .env.staging.local] [--evidence path] [--config-only]");
    return;
  }

  const envFile = resolve(process.cwd(), options.envFile);
  if (!existsSync(envFile)) {
    console.error(`Staging environment file not found: ${envFile}`);
    process.exitCode = 1;
    return;
  }

  const env = loadStagingEnvironment(envFile);
  const configurationChecks = validateStagingEnvironment(env);
  const runtimeChecks = options.configOnly || !passed(configurationChecks) ? [] : await probeStagingRuntime(env);
  const evidence = buildEvidence({
    envFile: options.envFile,
    configurationChecks,
    runtimeChecks,
  });

  printChecks("Staging configuration", configurationChecks);
  if (!options.configOnly) printChecks("Runtime readiness", runtimeChecks);

  const evidenceFile = resolve(process.cwd(), options.evidenceFile);
  mkdirSync(dirname(evidenceFile), { recursive: true });
  writeFileSync(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(`\nEvidence written to ${options.evidenceFile}`);

  if (evidence.result !== "pass") process.exitCode = 1;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) await main();

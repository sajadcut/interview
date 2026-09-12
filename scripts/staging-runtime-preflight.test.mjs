import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEvidence,
  parseEnvText,
  passed,
  probeStagingRuntime,
  validateStagingEnvironment,
} from "./staging-runtime-preflight.mjs";

function validEnvironment() {
  return {
    NODE_ENV: "production",
    SUPERVISED_PILOT_ENABLED: "false",
    DATABASE_URL: "postgresql://interview:secret@db.internal:5432/interview",
    MEDIA_REALTIME_ENABLED: "true",
    MEDIA_TRANSPORT_PROVIDER: "livekit",
    LIVEKIT_URL: "wss://rtc.example.test",
    LIVEKIT_HEALTH_URL: "https://rtc.example.test",
    LIVEKIT_API_KEY: "staging-key",
    LIVEKIT_API_SECRET: "0123456789abcdef0123456789abcdef",
    TURN_URLS: "turn:turn.example.test:3478,turns:turn.example.test:5349",
    MEDIA_WORKER_SHARED_SECRET: "abcdef0123456789abcdef0123456789",
    MEDIA_WORKER_BASE_URL: "https://media.example.test",
    STT_PROVIDER: "whisper-http",
    STT_BASE_URL: "https://media.example.test/stt",
    FFMPEG_ENABLED: "true",
    WHISPER_CLI: "/opt/whisper/whisper-cli",
    WHISPER_MODEL_PATH: "/opt/models/ggml-medium.bin",
    VAD_PROVIDER: "silero-http",
    VAD_BASE_URL: "https://vad.example.test",
    TTS_PROVIDER: "local-http",
    TTS_BASE_URL: "https://tts.example.test",
    TTS_COMMAND: "/opt/tts/synthesize --input {text_file} --output {output_wav}",
    LLM_PROVIDER: "openai-compatible",
    LLM_MODEL: "provider-model",
    LLM_API_KEY: "test-api-key",
    AI_WORKER_SHARED_SECRET: "fedcba9876543210fedcba9876543210",
    AI_INTERVIEWER_BASE_URL: "https://ai.example.test",
    STAGING_API_BASE_URL: "https://api.example.test",
  };
}

test("parseEnvText ignores comments and preserves values after the first equals sign", () => {
  const parsed = parseEnvText(`\n# comment\nNODE_ENV=production\nTOKEN="abc=def"\nINVALID LINE\n`);
  assert.deepEqual(parsed, { NODE_ENV: "production", TOKEN: "abc=def" });
});

test("valid production-like staging configuration passes without enabling supervised pilot", () => {
  const checks = validateStagingEnvironment(validEnvironment());
  assert.equal(passed(checks), true);
  assert.equal(checks.find((check) => check.id === "pilot.disabled")?.status, "pass");
});

test("preflight fails closed for insecure transport, weak secrets and missing real providers", () => {
  const env = validEnvironment();
  env.LIVEKIT_URL = "ws://rtc.example.test";
  env.LIVEKIT_API_SECRET = "secret";
  env.MEDIA_REALTIME_ENABLED = "false";
  env.STT_PROVIDER = "disabled";
  env.LLM_PROVIDER = "disabled";
  env.SUPERVISED_PILOT_ENABLED = "true";
  const checks = validateStagingEnvironment(env);
  assert.equal(passed(checks), false);
  for (const id of [
    "pilot.disabled",
    "media.enabled",
    "livekit.url",
    "livekit.api_secret",
    "stt.provider",
    "llm.provider",
  ]) {
    assert.equal(checks.find((check) => check.id === id)?.status, "fail", id);
  }
});

test("runtime probes require ready responses from API, media, speech and interviewer services", async () => {
  const env = validEnvironment();
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    let body = { ready: true };
    if (parsed.pathname === "/health" && parsed.host === "api.example.test") body = { status: "ok" };
    if (parsed.pathname === "/health/ready") body = { status: "ready" };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const checks = await probeStagingRuntime(env, { fetchImpl, timeoutMs: 100 });
  assert.equal(passed(checks), true);
  assert.equal(checks.length, 11);
});

test("evidence contains check outcomes but never copies environment secrets", () => {
  const env = validEnvironment();
  const configurationChecks = validateStagingEnvironment(env);
  const evidence = buildEvidence({ envFile: ".env.staging", configurationChecks, runtimeChecks: [] });
  const serialized = JSON.stringify(evidence);
  assert.equal(serialized.includes(env.LIVEKIT_API_SECRET), false);
  assert.equal(serialized.includes(env.MEDIA_WORKER_SHARED_SECRET), false);
  assert.equal(serialized.includes(env.LLM_API_KEY), false);
});

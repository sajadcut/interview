import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSmokeEvidence,
  runCandidateInterviewerSmoke,
  runSpeechRoundTripSmoke,
} from "./staging-runtime-smoke.mjs";

function env() {
  return {
    STAGING_API_BASE_URL: "https://api.example.test",
    TTS_BASE_URL: "https://tts.example.test",
    VAD_BASE_URL: "https://vad.example.test",
    STT_BASE_URL: "https://media.example.test/stt",
    STT_REQUEST_TIMEOUT_MS: "5000",
    MEDIA_WORKER_SHARED_SECRET: "abcdef0123456789abcdef0123456789",
    LLM_API_KEY: "provider-key-value",
  };
}

function wavBytes() {
  const value = Buffer.alloc(48);
  value.write("RIFF", 0, "ascii");
  value.writeUInt32LE(40, 4);
  value.write("WAVE", 8, "ascii");
  value.write("fmt ", 12, "ascii");
  return value;
}

function mockFetch(url, init = {}) {
  const parsed = new URL(url);
  if (init.method === "GET" && parsed.pathname === "/v1/candidate-interview/health") {
    return Promise.resolve(new Response(JSON.stringify({
      service: "candidate-interview",
      ready: true,
      activeMode: "llm",
      interviewer: { ready: true },
    }), { status: 200, headers: { "content-type": "application/json" } }));
  }
  if (init.method === "POST" && parsed.host === "tts.example.test" && parsed.pathname === "/synthesize") {
    return Promise.resolve(new Response(wavBytes(), {
      status: 200,
      headers: {
        "content-type": "audio/wav",
        "x-tts-contract-version": "tts-synthesis.v1",
        "x-request-id": "test-request",
        "x-tts-provider": "local-command",
      },
    }));
  }
  if (init.method === "POST" && parsed.host === "vad.example.test" && parsed.pathname === "/analyze") {
    return Promise.resolve(new Response(JSON.stringify({
      contractVersion: "silero-vad.v1",
      provider: "silero-vad",
      requestId: "test-request",
      speechDetected: true,
      segments: [{ startSeconds: 0.05, endSeconds: 1.2 }],
      sampleRate: 16000,
    }), { status: 200, headers: { "content-type": "application/json" } }));
  }
  if (init.method === "POST" && parsed.host === "media.example.test" && parsed.pathname === "/stt/finalize") {
    return Promise.resolve(new Response(JSON.stringify({
      contractVersion: "whisper-stt.v1",
      requestId: "test-request",
      provider: "whisper.cpp",
      text: "تست فنی Kubernetes و Redis",
      isFinal: true,
      language: "fa",
    }), { status: 200, headers: { "content-type": "application/json" } }));
  }
  return Promise.resolve(new Response("not found", { status: 404 }));
}

test("candidate interviewer smoke rejects deterministic fallback", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    ready: true,
    activeMode: "deterministic_fallback",
    interviewer: { ready: false },
  }), { status: 200, headers: { "content-type": "application/json" } });
  const check = await runCandidateInterviewerSmoke(env(), { fetchImpl, timeoutMs: 100 });
  assert.equal(check.status, "fail");
});

test("speech round trip proves TTS, VAD and Whisper using one ephemeral WAV", async () => {
  const checks = await runSpeechRoundTripSmoke(env(), { fetchImpl: mockFetch, timeoutMs: 100 });
  assert.deepEqual(checks.map((item) => [item.id, item.status]), [
    ["smoke.tts", "pass"],
    ["smoke.vad", "pass"],
    ["smoke.stt", "pass"],
  ]);
  assert.ok(checks.find((item) => item.id === "smoke.stt").measurements.transcriptChars > 0);
});

test("smoke evidence stores measurements but no transcript, synthetic phrase, or secrets", () => {
  const secret = env().MEDIA_WORKER_SHARED_SECRET;
  const syntheticPhrase = "این یک متن محرمانه تستی است";
  const evidence = buildSmokeEvidence({
    envFile: ".env.staging.local",
    preflight: {
      schemaVersion: "staging-runtime-preflight.v1",
      result: "pass",
      configurationChecks: [{ id: "config", status: "pass", detail: "ok" }],
      runtimeChecks: [{ id: "runtime", status: "pass", detail: "ok" }],
    },
    smokeChecks: [
      { id: "smoke.stt", status: "pass", detail: "ok", measurements: { transcriptChars: 24 } },
    ],
  });
  const serialized = JSON.stringify(evidence);
  assert.equal(evidence.result, "pass");
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes(syntheticPhrase), false);
  assert.equal(serialized.includes("Kubernetes"), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { InterviewSpeechService } from "./interview-speech.service";

const row = {
  mode: "audio",
  media_status: "connected",
  checkpoint: { candidateIsRealCustomerCandidate: false },
  action: "ask_question",
  spoken_text: "Persisted approved speech",
  finalized: true,
};

function serviceWith(options: { ttsReady?: boolean; speechDetected?: boolean } = {}) {
  const sql = async () => [row];
  const database = { sql };
  const tenant = { require: () => ({ organizationId: "11111111-1111-4111-8111-111111111111" }) };
  const mediaCalls: unknown[] = [];
  const media = {
    async getReadiness() {
      throw new Error("global media readiness must never be called by standalone TTS");
    },
    async appendEvent(...args: unknown[]) {
      mediaCalls.push(args);
    },
  };
  const ttsCalls: string[] = [];
  const tts = {
    providerKey: "local-http",
    enabled: true,
    configured: true,
    async readiness() {
      ttsCalls.push("readiness");
      return options.ttsReady === false
        ? { reachable: true, ready: false, reason: "provider_unavailable" }
        : { reachable: true, ready: true, contractVersion: "tts-synthesis.v1" };
    },
    async synthesize(input: { spokenText: string; requestId?: string }) {
      ttsCalls.push("synthesize");
      assert.equal(input.spokenText, row.spoken_text);
      return {
        contractVersion: "tts-synthesis.v1",
        provider: "local-command",
        requestId: input.requestId ?? "",
        audio: Uint8Array.from([82, 73, 70, 70, 0, 0, 0, 0, 87, 65, 86, 69]),
        contentType: "audio/wav" as const,
        attempts: 1,
      };
    },
  };
  const vadCalls: string[] = [];
  const vad = {
    providerKey: "silero-http",
    enabled: true,
    configured: true,
    async readiness() {
      vadCalls.push("readiness");
      return { reachable: true, ready: true, contractVersion: "silero-vad.v1" };
    },
    async analyze(input: { requestId?: string }) {
      vadCalls.push("analyze");
      const speechDetected = options.speechDetected !== false;
      return {
        contractVersion: "silero-vad.v1",
        provider: "silero-vad",
        requestId: input.requestId ?? "",
        speechDetected,
        segments: speechDetected ? [{ startSeconds: 0.1, endSeconds: 1.1 }] : [],
        sampleRate: 16000 as const,
        durationSeconds: 1.25,
        attempts: 1,
      };
    },
  };
  const sttCalls: string[] = [];
  const stt = {
    providerKey: "whisper-http",
    enabled: true,
    configured: true,
    async readiness() {
      sttCalls.push("readiness");
      return { reachable: true, ready: true, contractVersion: "whisper-stt.v1" };
    },
    async transcribe(input: { requestId?: string }) {
      sttCalls.push("transcribe");
      return {
        contractVersion: "whisper-stt.v1",
        provider: "whisper.cpp",
        requestId: input.requestId ?? "",
        text: "پاسخ آزمایشی کاندید",
        isFinal: true as const,
        language: "fa",
        attempts: 1,
      };
    },
  };
  return {
    service: new InterviewSpeechService(
      database as never,
      tenant as never,
      media as never,
      tts,
      vad,
      stt,
    ),
    mediaCalls,
    ttsCalls,
    vadCalls,
    sttCalls,
  };
}

test("persisted TTS uses component-local readiness and never probes the global realtime pipeline", async () => {
  const { service, ttsCalls, mediaCalls } = serviceWith();
  const result = await service.synthesizePersistedTurn(
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333",
    "44444444-4444-4444-8444-444444444444",
  );
  assert.equal(result.contentType, "audio/wav");
  assert.deepEqual(ttsCalls, ["readiness", "synthesize"]);
  assert.equal(mediaCalls.length, 2);
});

test("TTS-local readiness failure blocks synthesis without consulting other media components", async () => {
  const { service, ttsCalls } = serviceWith({ ttsReady: false });
  await assert.rejects(() =>
    service.synthesizePersistedTurn(
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
      "44444444-4444-4444-8444-444444444444",
    ),
  );
  assert.deepEqual(ttsCalls, ["readiness"]);
});

test("candidate audio runs VAD before Whisper and returns no transcript for silence", async () => {
  const { service, vadCalls, sttCalls, mediaCalls } = serviceWith({ speechDetected: false });
  const result = await service.transcribeCandidateAudio(
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333",
    Uint8Array.from([82, 73, 70, 70]),
    "audio/wav",
  );
  assert.equal(result.speechDetected, false);
  assert.equal(result.transcript, null);
  assert.deepEqual(vadCalls, ["readiness", "analyze"]);
  assert.deepEqual(sttCalls, ["readiness"]);
  assert.equal(mediaCalls.length, 1);
});

test("candidate speech is transcribed only after positive VAD", async () => {
  const { service, vadCalls, sttCalls, mediaCalls } = serviceWith();
  const result = await service.transcribeCandidateAudio(
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333",
    Uint8Array.from([82, 73, 70, 70]),
    "audio/wav",
  );
  assert.equal(result.speechDetected, true);
  assert.equal(result.transcript?.text, "پاسخ آزمایشی کاندید");
  assert.deepEqual(vadCalls, ["readiness", "analyze"]);
  assert.deepEqual(sttCalls, ["readiness", "transcribe"]);
  assert.equal(mediaCalls.length, 3);
});

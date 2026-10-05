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

function serviceWith(options: {
  ttsReady?: boolean;
  speechDetected?: boolean;
  spokenText?: string;
  pronunciationText?: string;
  pronunciationFails?: boolean;
  ttsProvider?: string;
} = {}) {
  const activeRow = { ...row, spoken_text: options.spokenText ?? row.spoken_text };
  const sql = async () => [activeRow];
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
  const aiCalls: string[] = [];
  const ai = {
    async pronouncePersianForTts(input: { spokenText: string }) {
      aiCalls.push(input.spokenText);
      if (options.pronunciationFails) throw new Error("pronunciation unavailable");
      return {
        ttsText: options.pronunciationText ?? input.spokenText,
        provenance: {
          provider: "openai-compatible",
          promptId: "speech.persian_pronunciation",
          promptVersion: "v1",
        },
      };
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
        : {
            reachable: true,
            ready: true,
            contractVersion: "tts-synthesis.v1",
            provider: options.ttsProvider ?? "local-command",
          };
    },
    async synthesize(input: { spokenText: string; requestId?: string }) {
      ttsCalls.push("synthesize");
      const expectedText =
        options.ttsProvider === "ava-82m-persian-cpu"
          ? activeRow.spoken_text
          : options.pronunciationText ?? activeRow.spoken_text;
      assert.equal(input.spokenText, expectedText);
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
      ai as never,
      tts,
      vad,
      stt,
    ),
    mediaCalls,
    aiCalls,
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

test("Persian TTS uses the LLM pronunciation rendering before synthesis", async () => {
  const { service, aiCalls, ttsCalls } = serviceWith({
    spokenText: "در مورد تخصیص منابع توضیح بده.",
    pronunciationText: "دَر مورِدِ تَخصیصِ مَنابِع توضیح بِدِه.",
  });
  await service.synthesizePersistedTurn(
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333",
    "44444444-4444-4444-8444-444444444444",
  );
  assert.deepEqual(aiCalls, ["در مورد تخصیص منابع توضیح بده."]);
  assert.deepEqual(ttsCalls, ["readiness", "synthesize"]);
});

test("Ava Persian TTS uses native contextual G2P and skips LLM pronunciation", async () => {
  const { service, aiCalls, ttsCalls, mediaCalls } = serviceWith({
    spokenText: "در مورد تخصیص منابع و معماری سیستم توضیح بده.",
    ttsProvider: "ava-82m-persian-cpu",
  });
  await service.synthesizePersistedTurn(
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333",
    "44444444-4444-4444-8444-444444444444",
  );
  assert.deepEqual(aiCalls, []);
  assert.deepEqual(ttsCalls, ["readiness", "synthesize"]);
  const started = mediaCalls[0] as [unknown, unknown, { payload?: { pronunciationMode?: string } }];
  assert.equal(started[2]?.payload?.pronunciationMode, "native_g2p");
});

test("Persian pronunciation failure falls back to the canonical finalized text", async () => {
  const { service, aiCalls, ttsCalls } = serviceWith({
    spokenText: "درباره معماری سیستم توضیح بده.",
    pronunciationFails: true,
  });
  await service.synthesizePersistedTurn(
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333",
    "44444444-4444-4444-8444-444444444444",
  );
  assert.deepEqual(aiCalls, ["درباره معماری سیستم توضیح بده."]);
  assert.deepEqual(ttsCalls, ["readiness", "synthesize"]);
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

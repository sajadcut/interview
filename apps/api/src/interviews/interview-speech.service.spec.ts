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

function serviceWith(options: { ttsReady?: boolean } = {}) {
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
  return {
    service: new InterviewSpeechService(database as never, tenant as never, media as never, tts),
    mediaCalls,
    ttsCalls,
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

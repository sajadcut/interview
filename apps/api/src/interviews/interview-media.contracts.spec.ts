import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateRealtimeMediaReadiness,
  requiredMediaComponents,
  type MediaProviderStatus,
} from "./interview-media.contracts";

function readyProviders(): MediaProviderStatus[] {
  return [
    { component: "transport", provider: "livekit", configured: true, reachable: true, ready: true },
    { component: "vad", provider: "silero", configured: true, reachable: true, ready: true },
    { component: "stt", provider: "whisper", configured: true, reachable: true, ready: true },
    { component: "tts", provider: "local-tts", configured: true, reachable: true, ready: true },
    { component: "avatar", provider: "musetalk", configured: true, reachable: true, ready: true },
  ];
}

test("audio mode requires transport, VAD, STT and TTS but not avatar", () => {
  assert.deepEqual(requiredMediaComponents("audio"), ["transport", "vad", "stt", "tts"]);
  const providers = readyProviders().filter((provider) => provider.component !== "avatar");
  const readiness = evaluateRealtimeMediaReadiness({ enabled: true, mode: "audio", providers });
  assert.equal(readiness.ready, true);
  assert.deepEqual(readiness.blockers, []);
});

test("avatar mode requires the avatar provider", () => {
  const providers = readyProviders().filter((provider) => provider.component !== "avatar");
  const readiness = evaluateRealtimeMediaReadiness({ enabled: true, mode: "avatar", providers });
  assert.equal(readiness.ready, false);
  assert.ok(readiness.blockers.some((blocker) => blocker.startsWith("avatar:")));
});

test("configured but unreachable provider is not considered ready", () => {
  const providers = readyProviders().map((provider) =>
    provider.component === "stt" ? { ...provider, reachable: false, ready: false } : provider,
  );
  const readiness = evaluateRealtimeMediaReadiness({ enabled: true, mode: "audio", providers });
  assert.equal(readiness.ready, false);
  assert.ok(readiness.blockers.some((blocker) => blocker.includes("stt: whisper is not reachable")));
});

test("privacy invariants are explicit and cannot be inferred from provider readiness", () => {
  const readiness = evaluateRealtimeMediaReadiness({ enabled: false, mode: "avatar", providers: [] });
  assert.equal(readiness.privacy.candidateVideoAnalysis, "none");
  assert.equal(readiness.privacy.biometricInferenceAllowed, false);
  assert.equal(readiness.privacy.rawMediaPersistedByApi, false);
  assert.equal(readiness.privacy.spokenTextOnlyToAvatar, true);
  assert.equal(readiness.ready, false);
});

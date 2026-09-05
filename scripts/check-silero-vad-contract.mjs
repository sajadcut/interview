import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const paths = {
  contract: resolve(root, "contracts/silero-vad.v1.json"),
  layer: resolve(root, "services/vad-worker/vad_layer.py"),
  server: resolve(root, "services/vad-worker/server.py"),
  layerTests: resolve(root, "services/vad-worker/test/test_vad_layer.py"),
  httpTests: resolve(root, "services/vad-worker/test/test_vad_http_contract.py"),
  client: resolve(root, "apps/api/src/interviews/silero-vad-http.client.ts"),
  clientTests: resolve(root, "apps/api/src/interviews/silero-vad-http.client.spec.ts"),
  adapter: resolve(root, "apps/api/src/interviews/voice-activity-detection.adapter.ts"),
  providers: resolve(root, "apps/api/src/interviews/interview-media.providers.ts"),
  module: resolve(root, "apps/api/src/interviews/interviews.module.ts"),
  docs: resolve(root, "docs/operations/silero-vad-integration-contract.md"),
  env: resolve(root, ".env.example"),
  package: resolve(root, "package.json"),
};

function invariant(condition, message) {
  if (!condition) throw new Error(`Silero VAD integration contract check failed: ${message}`);
}

const entries = await Promise.all(Object.values(paths).map((path) => readFile(path, "utf8")));
const [
  contractText,
  layerSource,
  serverSource,
  layerTests,
  httpTests,
  clientSource,
  clientTests,
  adapterSource,
  providersSource,
  moduleSource,
  docsSource,
  envSource,
  packageText,
] = entries;
const contract = JSON.parse(contractText);
const pkg = JSON.parse(packageText);

invariant(contract.version === "silero-vad.v1", "version drift");
invariant(contract.provider === "silero-vad", "provider drift");
invariant(
  JSON.stringify(contract.independentOf) ===
    JSON.stringify(["llm", "whisper", "livekit", "ffmpeg", "tts"]),
  "standalone dependency boundary drift",
);
invariant(contract.health?.doesNotProbeOtherComponents === true, "health must remain component-local");
invariant(contract.health?.loadsSileroModel === true, "health must verify model load");
invariant(contract.response?.segmentsSorted === true, "segments must remain sorted");
invariant(contract.response?.segmentsNonOverlapping === true, "segments must remain non-overlapping");
invariant(
  contract.response?.speechDetectedMatchesSegmentPresence === true,
  "speechDetected must match segment presence",
);
invariant(contract.privacy?.rawAudioPersistedByWorker === false, "worker must not persist raw audio");
invariant(contract.client?.redirects === "manual", "redirects must remain disabled");
invariant(contract.client?.productionHttpsRequired === true, "production HTTPS policy drift");
invariant(contract.testEvidence?.realSileroRequired === false, "CI must not require Silero");
invariant(
  contract.testEvidence?.representativeAudioQualityPending === true,
  "real audio quality must remain evidence-gated",
);

for (const marker of [
  'CONTRACT_VERSION = "silero-vad.v1"',
  "class SileroVadEngine",
  "class VADAnalyzer",
  "TemporaryDirectory",
  "load_silero_vad",
  "get_speech_timestamps",
  "validate_segments",
  "raw_segments",
]) {
  invariant(layerSource.includes(marker), `worker layer marker missing: ${marker}`);
}

for (const marker of [
  'self.path != "/health"',
  'self.path != "/analyze"',
  '"x-vad-contract-version"',
  '"x-vad-secret"',
  "VADAnalyzer().analyze",
]) {
  invariant(serverSource.includes(marker), `worker HTTP marker missing: ${marker}`);
}

for (const marker of [
  "FakeEngine",
  "invalid_provider_output",
  "temporary_audio_is_removed",
  "independentOf",
]) {
  invariant(
    layerTests.includes(marker) || httpTests.includes(marker),
    `worker test marker missing: ${marker}`,
  );
}

for (const marker of [
  'SILERO_VAD_CONTRACT_VERSION = "silero-vad.v1"',
  'readonly providerKey = "silero-http"',
  'redirect: "manual"',
  '"x-vad-contract-version"',
  '"x-vad-secret"',
  "parseSegments",
]) {
  invariant(clientSource.includes(marker), `API client marker missing: ${marker}`);
}

invariant(
  clientTests.includes("touches only the configured VAD endpoint"),
  "standalone API client test missing",
);
invariant(
  adapterSource.includes("VOICE_ACTIVITY_DETECTION_ADAPTER"),
  "VAD adapter token missing",
);
invariant(
  providersSource.includes('version: "silero-vad.v1"'),
  "media readiness must record VAD contract version",
);
invariant(
  moduleSource.includes("useExisting: SileroVadHttpClient"),
  "VAD adapter wiring missing",
);
invariant(
  docsSource.includes("Real audio testing is deliberately deferred"),
  "deferred audio evidence boundary missing",
);
invariant(
  envSource.includes("VAD_BASE_URL=http://127.0.0.1:9030"),
  "standalone VAD worker URL missing from env example",
);

invariant(
  pkg.scripts?.["vad:contract:check"] === "node scripts/check-silero-vad-contract.mjs",
  "contract script missing",
);
invariant(
  pkg.scripts?.["vad-worker:test"]?.includes("services/vad-worker/test"),
  "worker test script missing",
);
invariant(pkg.scripts?.test?.includes("vad:contract:check"), "root test must enforce VAD contract");
invariant(pkg.scripts?.test?.includes("vad-worker:test"), "root test must execute VAD worker tests");

console.log(
  "Silero VAD Contract v1 is internally consistent without requiring Silero or the realtime media flow.",
);

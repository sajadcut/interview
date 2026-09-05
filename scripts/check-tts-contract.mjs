import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const paths = {
  contract: resolve(root, "contracts/tts-synthesis.v1.json"),
  layer: resolve(root, "services/tts-worker/tts_layer.py"),
  server: resolve(root, "services/tts-worker/server.py"),
  layerTests: resolve(root, "services/tts-worker/test/test_tts_layer.py"),
  httpTests: resolve(root, "services/tts-worker/test/test_tts_http_contract.py"),
  client: resolve(root, "apps/api/src/interviews/tts-http.client.ts"),
  clientTests: resolve(root, "apps/api/src/interviews/tts-http.client.spec.ts"),
  adapter: resolve(root, "apps/api/src/interviews/text-to-speech.adapter.ts"),
  speechService: resolve(root, "apps/api/src/interviews/interview-speech.service.ts"),
  speechTests: resolve(root, "apps/api/src/interviews/interview-speech.service.spec.ts"),
  module: resolve(root, "apps/api/src/interviews/interviews.module.ts"),
  docs: resolve(root, "docs/operations/tts-integration-contract.md"),
  package: resolve(root, "package.json"),
};

function invariant(condition, message) {
  if (!condition) throw new Error(`TTS integration contract check failed: ${message}`);
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
  speechSource,
  speechTests,
  moduleSource,
  docsSource,
  packageText,
] = entries;
const contract = JSON.parse(contractText);
const pkg = JSON.parse(packageText);

invariant(contract.version === "tts-synthesis.v1", "version drift");
invariant(contract.provider === "local-command", "provider drift");
invariant(
  JSON.stringify(contract.independentOf) === JSON.stringify(["llm", "whisper", "livekit", "ffmpeg"]),
  "standalone dependency boundary drift",
);
invariant(contract.health?.doesNotProbeOtherComponents === true, "health must remain component-local");
invariant(contract.commandAdapter?.shell === false, "shell execution must remain disabled");
invariant(contract.commandAdapter?.stdin === "disabled", "stdin must remain disabled");
invariant(contract.commandAdapter?.textTransport === "utf8-temporary-file", "spoken text must stay off argv");
invariant(
  JSON.stringify(contract.commandAdapter?.requiredPlaceholders) === JSON.stringify(["{text_file}", "{output_wav}"]),
  "command placeholders drift",
);
invariant(contract.process?.processGroupIsolation === true, "process group isolation must remain enabled");
invariant(contract.process?.terminateThenKill === true, "terminate-then-kill policy must remain enabled");
invariant(contract.process?.diagnosticMaxBytes === 8192, "diagnostic bound drift");
invariant(contract.cleanup?.removeOnSuccess === true && contract.cleanup?.removeOnFailure === true, "workspace cleanup drift");
invariant(contract.cleanup?.spokenTextPersistedByWorker === false, "worker must not persist spoken text");
invariant(contract.cleanup?.audioPersistedByWorker === false, "worker must not persist synthesized audio");
invariant(contract.coreSafety?.clientSuppliedTextAccepted === false, "core API must reject client-supplied TTS text");
invariant(contract.coreSafety?.globalRealtimeReadinessRequiredForSynthesis === false, "TTS must not depend on global realtime readiness");
invariant(contract.testEvidence?.realTtsEngineRequired === false, "contract tests must not require a TTS engine");

for (const marker of [
  'CONTRACT_VERSION = "tts-synthesis.v1"',
  "class TTSCommandBuilder",
  "class TTSProcessRunner",
  "shell=False",
  "start_new_session",
  "os.killpg",
  "signal.SIGTERM",
  "signal.SIGKILL",
  "TemporaryDirectory",
  "validate_wav",
  "DIAGNOSTIC_MAX_BYTES = 8192",
]) {
  invariant(layerSource.includes(marker), `worker layer marker missing: ${marker}`);
}

for (const marker of [
  'self.path != "/health"',
  'self.path != "/synthesize"',
  '"x-tts-contract-version"',
  '"x-tts-provider"',
  "TTSProcessRunner().synthesize",
]) {
  invariant(serverSource.includes(marker), `worker HTTP marker missing: ${marker}`);
}

for (const marker of [
  "sys.executable",
  "provider_timeout",
  "invalid_audio_output",
  "independentOf",
]) {
  invariant(layerTests.includes(marker) || httpTests.includes(marker), `worker test marker missing: ${marker}`);
}

for (const marker of [
  'TTS_CONTRACT_VERSION = "tts-synthesis.v1"',
  'readonly providerKey = "local-http"',
  'redirect: "manual"',
  '"x-tts-contract-version"',
  '"x-tts-secret"',
  "readBoundedBytes",
  "hasValidWavHeader",
]) {
  invariant(clientSource.includes(marker), `API client marker missing: ${marker}`);
}
invariant(clientTests.includes("touches only the configured TTS endpoint"), "standalone API client test missing");
invariant(adapterSource.includes("TEXT_TO_SPEECH_ADAPTER"), "TTS adapter token missing");
invariant(speechSource.includes("TEXT_TO_SPEECH_ADAPTER"), "InterviewSpeechService must use TTS adapter");
invariant(speechSource.includes("await this.tts.readiness()"), "InterviewSpeechService must use TTS-local readiness");
invariant(!/await\s+this\.media\.getReadiness\s*\(/.test(speechSource), "InterviewSpeechService must not await global media readiness");
invariant(speechSource.includes("t.spoken_text") && speechSource.includes("t.finalized"), "persisted finalized spoken_text safety boundary missing");
invariant(speechTests.includes("global realtime pipeline"), "service independence regression test missing");
invariant(moduleSource.includes("useExisting: TtsHttpClient"), "TTS adapter wiring missing");
invariant(docsSource.includes("does not call `InterviewMediaService.getReadiness()`"), "standalone boundary documentation missing");

invariant(pkg.scripts?.["tts:contract:check"] === "node scripts/check-tts-contract.mjs", "contract script missing");
invariant(pkg.scripts?.["tts-worker:test"]?.includes("services/tts-worker/test"), "worker test script missing");
invariant(pkg.scripts?.test?.includes("tts:contract:check"), "root test must enforce TTS contract");
invariant(pkg.scripts?.test?.includes("tts-worker:test"), "root test must execute TTS worker tests");

console.log("TTS Synthesis Contract v1 is internally consistent without requiring a real TTS engine.");

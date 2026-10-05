import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const paths = {
  contract: resolve(root, "contracts/tts-synthesis.v1.json"),
  layer: resolve(root, "services/tts-worker/tts_layer.py"),
  edgeLayer: resolve(root, "services/tts-worker/edge_tts_layer.py"),
  server: resolve(root, "services/tts-worker/server.py"),
  layerTests: resolve(root, "services/tts-worker/test/test_tts_layer.py"),
  httpTests: resolve(root, "services/tts-worker/test/test_tts_http_contract.py"),
  avaServer: resolve(root, "services/ava-tts-worker/server.py"),
  avaNormalizer: resolve(root, "services/ava-tts-worker/fa_tech_normalizer.py"),
  avaTests: resolve(root, "services/ava-tts-worker/test/test_ava_tts_worker.py"),
  avaSetup: resolve(root, "scripts/setup-ava-tts-windows.ps1"),
  startAll: resolve(root, "start-all.ps1"),
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
  edgeLayerSource,
  serverSource,
  layerTests,
  httpTests,
  avaServerSource,
  avaNormalizerSource,
  avaTests,
  avaSetupSource,
  startAllSource,
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
invariant(contract.provider === "ava-82m-persian-cpu", "preferred Persian provider drift");
invariant(contract.fallbackProvider === "edge-tts", "Edge fallback provider drift");
invariant(contract.legacyFallbackProvider === "local-command", "legacy fallback provider drift");
invariant(
  JSON.stringify(contract.response?.acceptedContentTypes) === JSON.stringify(["audio/mpeg", "audio/wav"]),
  "TTS response content types drift",
);
invariant(contract.avaAdapter?.model === "xmanii/Ava-82M", "Ava model drift");
invariant(contract.avaAdapter?.modelVersion === "0.2.0", "Ava model version drift");
invariant(contract.avaAdapter?.license === "Apache-2.0", "Ava license metadata drift");
invariant(contract.avaAdapter?.device === "cpu", "Ava must remain CPU-only");
invariant(contract.avaAdapter?.sampleRate === 24000, "Ava sample rate drift");
invariant(contract.avaAdapter?.localGpuRequired === false, "Ava must not require local GPU");
invariant(contract.avaAdapter?.contextualPersianG2p === true, "Ava native Persian G2P boundary drift");
invariant(contract.avaAdapter?.defaultDevelopmentRuntime === true, "Ava must remain default in development");
invariant(contract.edgeAdapter?.voiceDefault === "fa-IR-FaridNeural", "Persian Edge fallback voice drift");
invariant(contract.edgeAdapter?.pythonPackage === "edge-tts", "Edge Python package drift");
invariant(contract.edgeAdapter?.textTransport === "in-process-python-module", "Edge text transport drift");
invariant(contract.edgeAdapter?.temporaryFileRequired === false, "Edge provider must not require temp text files");
invariant(contract.edgeAdapter?.localGpuRequired === false, "Edge provider must not require local GPU");
invariant(contract.edgeAdapter?.shell === false, "Edge provider must remain shell-free");
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
  'PROVIDER = "edge-tts"',
  'CONTENT_TYPE = "audio/mpeg"',
  'DEFAULT_VOICE = "fa-IR-FaridNeural"',
  "class EdgeTTSRunner",
  "edge_tts_module.Communicate",
  "communicate.stream()",
  "asyncio.wait_for",
  "validate_mp3_bytes",
]) {
  invariant(edgeLayerSource.includes(marker), `Edge TTS layer marker missing: ${marker}`);
}

for (const marker of [
  'PROVIDER = "ava-82m-persian-cpu"',
  'MODEL_ID = "xmanii/Ava-82M"',
  'MODEL_VERSION = "0.2.0"',
  'CONTENT_TYPE = "audio/wav"',
  "SAMPLE_RATE = 24_000",
  'Ava.from_pretrained(MODEL_ID, device="cpu")',
  "self.tts.generate",
  '"x-request-id"',
  '"x-tts-provider"',
  "validate_wav_bytes",
]) {
  invariant(avaServerSource.includes(marker), `Ava worker marker missing: ${marker}`);
}
invariant(avaNormalizerSource.includes("normalize_technical_terms"), "Ava technical-term normalizer missing");
invariant(avaTests.includes("synthesis_echoes_request_id"), "Ava HTTP contract test missing");
invariant(avaTests.includes("ava-82m-persian-cpu"), "Ava provider test missing");
invariant(avaSetupSource.includes("Python 3.13"), "Ava Python 3.13 compatibility guard missing");
invariant(avaSetupSource.includes('"numpy==2.1.3"'), "Ava setup must install the CPython 3.13 NumPy override");
invariant(avaSetupSource.includes('"sentencepiece==0.2.2"'), "Ava setup must install the CPython 3.13 SentencePiece override");
invariant(avaSetupSource.includes("--no-deps $WheelUrl"), "Ava wheel must bypass stale binary pins on Python 3.13");
invariant(avaSetupSource.includes("fba1236595f2d2bf21d414ba6e57d25256afada3"), "Ava setup must pin Python 3.13-enabled Misaki");
invariant(avaSetupSource.includes("git+https://github.com/hexgrad/misaki.git@fba1236595f2d2bf21d414ba6e57d25256afada3"), "Ava setup must install Misaki from upstream Git");
invariant(!avaSetupSource.includes("misaki[en] @"), "Ava setup must not install heavy Misaki English extras");
invariant(avaSetupSource.includes('"spacy==3.8.16"'), "Ava setup must pin CPython-3.13 spaCy wheel");
invariant(avaSetupSource.includes('"phonemizer-fork==3.3.2"'), "Ava setup must pin phonemizer import dependency");
invariant(avaSetupSource.includes('"espeakng-loader==0.2.4"'), "Ava setup must pin espeak loader import dependency");
invariant(contract.avaAdapter?.compatibilityOverrides?.misakiInstall === "core-git-no-extras", "Ava Misaki install mode drift");
invariant(contract.avaAdapter?.compatibilityOverrides?.kokoroImportDeps?.spacy === "3.8.16", "Ava spaCy import dependency drift");
invariant(contract.avaAdapter?.compatibilityOverrides?.kokoroImportDeps?.spacyCuratedTransformers === false, "Ava must avoid spaCy curated transformer extras");
invariant(avaSetupSource.includes("pip install --no-deps"), "Ava setup must use no-deps for pinned Kokoro/Ava packages");
invariant(contract.avaAdapter?.python === ">=3.11,<3.14", "Ava declared Python runtime contract drift");
invariant(contract.avaAdapter?.windowsSetupPython === "3.13", "Ava Windows setup Python drift");
invariant(contract.avaAdapter?.compatibilityOverrides?.numpy === "2.1.3", "Ava NumPy compatibility override drift");
invariant(contract.avaAdapter?.compatibilityOverrides?.sentencepiece === "0.2.2", "Ava SentencePiece compatibility override drift");
invariant(contract.avaAdapter?.compatibilityOverrides?.misakiGitRevision === "fba1236595f2d2bf21d414ba6e57d25256afada3", "Ava Misaki Python 3.13 revision drift");
invariant(contract.avaAdapter?.compatibilityOverrides?.kokoroInstallNoDeps === true, "Ava Kokoro must bypass stale PyPI Misaki metadata");
invariant(avaSetupSource.includes('"torch==2.6.0"'), "Ava setup must pin PyTorch 2.6.0");
invariant(avaSetupSource.includes("--index-url $PyPiIndex"), "Ava Windows setup must use the PyPI route");
invariant(!avaSetupSource.includes("download.pytorch.org/whl/cpu"), "Ava Windows setup must avoid the blocked PyTorch R2 route");
invariant(avaSetupSource.includes("24160e40cf970dc1b3dc245184e45d48e0fe89a9"), "Ava wheel release pin missing");
invariant(startAllSource.includes('[ValidateSet("ava-82m", "edge-tts", "local-command")]'), "start-all TTS choices drift");
invariant(startAllSource.includes('[string]$TtsEngine = "ava-82m"'), "start-all must default to Ava");
invariant(startAllSource.includes("ava-tts-worker:dev"), "start-all Ava worker wiring missing");

invariant(serverSource.includes("active_status()"), "worker synthesis readiness must follow the active engine");

for (const marker of [
  'self.path != "/health"',
  'self.path != "/synthesize"',
  '"x-tts-contract-version"',
  '"x-tts-provider"',
  "synthesize_audio(spoken_text)",
  'active_engine() == "edge-tts"',
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
  "hasValidMp3Header",
  '"audio/mpeg"',
]) {
  invariant(clientSource.includes(marker), `API client marker missing: ${marker}`);
}
invariant(clientTests.includes("touches only the configured TTS endpoint"), "standalone API client test missing");
invariant(adapterSource.includes("provider?: string"), "TTS readiness must expose active provider");
invariant(adapterSource.includes("TEXT_TO_SPEECH_ADAPTER"), "TTS adapter token missing");
invariant(speechSource.includes("TEXT_TO_SPEECH_ADAPTER"), "InterviewSpeechService must use TTS adapter");
invariant(speechSource.includes("await this.tts.readiness()"), "InterviewSpeechService must use TTS-local readiness");
invariant(!/await\s+this\.media\.getReadiness\s*\(/.test(speechSource), "InterviewSpeechService must not await global media readiness");
invariant(speechSource.includes('readiness.provider === "ava-82m-persian-cpu"'), "Ava native G2P routing missing");
invariant(speechSource.includes('"native_g2p"'), "Ava pronunciation mode marker missing");
invariant(speechSource.includes("t.spoken_text") && speechSource.includes("t.finalized"), "persisted finalized spoken_text safety boundary missing");
invariant(speechTests.includes("Ava Persian TTS uses native contextual G2P"), "Ava native G2P regression test missing");
invariant(speechTests.includes("global realtime pipeline"), "service independence regression test missing");
invariant(moduleSource.includes("useExisting: TtsHttpClient"), "TTS adapter wiring missing");
invariant(docsSource.includes("does not call `InterviewMediaService.getReadiness()`"), "standalone boundary documentation missing");

invariant(pkg.scripts?.["tts:contract:check"] === "node scripts/check-tts-contract.mjs", "contract script missing");
invariant(pkg.scripts?.["tts-worker:test"]?.includes("services/tts-worker/test"), "worker test script missing");
invariant(pkg.scripts?.["ava-tts-worker:dev"]?.includes("start-ava-tts-worker.ps1"), "Ava dev script missing");
invariant(pkg.scripts?.["ava-tts-worker:test"]?.includes("services/ava-tts-worker/test"), "Ava worker test script missing");
invariant(pkg.scripts?.test?.includes("tts:contract:check"), "root test must enforce TTS contract");
invariant(pkg.scripts?.test?.includes("tts-worker:test"), "root test must execute generic TTS worker tests");
invariant(pkg.scripts?.test?.includes("ava-tts-worker:test"), "root test must execute Ava worker tests");

console.log("TTS Synthesis Contract v1 is internally consistent with Ava CPU preferred and Edge fallback.");

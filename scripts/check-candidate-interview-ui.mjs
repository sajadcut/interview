import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const paths = {
  contract: resolve(root, "contracts/candidate-interview-ui.v1.json"),
  state: resolve(root, "apps/web/lib/candidate-interview-state.ts"),
  stateTests: resolve(root, "apps/web/lib/candidate-interview-state.spec.ts"),
  copy: resolve(root, "apps/web/lib/candidate-interview-copy.ts"),
  component: resolve(root, "apps/web/components/candidate/candidate-interview-experience.tsx"),
  page: resolve(root, "apps/web/app/candidate/interview/page.tsx"),
  runtime: resolve(root, "apps/web/lib/candidate-realtime-runtime.ts"),
  proxy: resolve(root, "apps/web/app/api/candidate-interview/[...path]/route.ts"),
  apiController: resolve(root, "apps/api/src/interviews/candidate-interview.controller.ts"),
  apiService: resolve(root, "apps/api/src/interviews/candidate-interview.service.ts"),
  e2e: resolve(root, "e2e/candidate-interview-ui.spec.ts"),
  docs: resolve(root, "docs/operations/candidate-interview-ui.md"),
  webPackage: resolve(root, "apps/web/package.json"),
  rootPackage: resolve(root, "package.json"),
};

function invariant(condition, message) {
  if (!condition) throw new Error(`Candidate Interview UI contract check failed: ${message}`);
}

const entries = await Promise.all(Object.values(paths).map((path) => readFile(path, "utf8")));
const [
  contractText,
  stateSource,
  stateTests,
  copySource,
  componentSource,
  pageSource,
  runtimeSource,
  proxySource,
  apiControllerSource,
  apiServiceSource,
  e2eSource,
  docsSource,
  webPackageText,
  rootPackageText,
] = entries;
const contract = JSON.parse(contractText);
const webPackage = JSON.parse(webPackageText);
const rootPackage = JSON.parse(rootPackageText);

invariant(contract.version === "candidate-interview-ui.v1", "version drift");
invariant(contract.surface === "/candidate/interview", "surface drift");
invariant(contract.securityBoundary?.candidateSessionCookieRequired === true, "candidate session gate must remain required");
invariant(contract.securityBoundary?.persistedConsentRequired === true, "persisted consent gate must remain required");
invariant(contract.securityBoundary?.internalTenantHeadersAllowed === false, "candidate UI must never use internal tenant headers");
invariant(contract.securityBoundary?.internalRecruiterMediaEndpointsAllowed === false, "candidate UI must not reuse recruiter media endpoints");
invariant(contract.securityBoundary?.fakeLiveStateAllowed === false, "fake live state must remain forbidden");
invariant(contract.securityBoundary?.candidateScopedApiPrefix === "/v1/candidate-interview", "candidate API prefix drift");
invariant(contract.securityBoundary?.sameOriginBrowserProxy === "/api/candidate-interview", "candidate browser proxy drift");
invariant(contract.permissions?.microphoneRequired === true, "microphone must remain required");
invariant(contract.permissions?.audioOnlyFallbackAllowed === true, "audio-only fallback must remain available");
invariant(contract.permissions?.getUserMediaRequiresUserAction === true, "media capture must remain user initiated");
invariant(contract.network?.maxReconnectAttempts === 3, "reconnect bound drift");
invariant(contract.runtime?.pageCreatesCandidateRuntime === true, "candidate page must own runtime creation");
invariant(contract.runtime?.remoteInterviewerVideoSurface === true, "remote interviewer video surface is required");
invariant(contract.runtime?.typedAnswersSupported === true, "typed answers are required");
invariant(contract.runtime?.voiceAnswersSupported === true, "voice answers are required");
invariant(contract.runtime?.voiceAnswerAutoSubmitsAfterSilence === true, "voice answers must auto-submit after silence");
invariant(contract.runtime?.turnAudioUsesPersistedFinalizedTurn === true, "TTS must stay bound to finalized server turns");
invariant(contract.runtime?.onlyRuntimeConnectedEventMayEnterLive === true, "live state provenance drift");
invariant(contract.privacy?.rawMediaPersistedByUi === false, "UI must not persist raw media");
invariant(contract.privacy?.biometricInferenceAllowed === false, "biometric inference must remain forbidden");

const exactStates = [
  "permissions",
  "ready",
  "connecting",
  "live",
  "reconnecting",
  "offline",
  "degraded",
  "fatal",
  "completed",
];
invariant(JSON.stringify(contract.states) === JSON.stringify(exactStates), "state list drift");

for (const marker of [
  "CandidateInterviewPhases",
  "candidateInterviewReducer",
  "candidateInterviewFallbacks",
  "maxReconnectAttempts",
  'case "NETWORK_OFFLINE"',
  'case "NETWORK_ONLINE"',
  'case "SESSION_EXPIRED"',
  'case "CONSENT_REQUIRED"',
  'case "CONNECTED"',
  'code: "runtime_unavailable"',
  'code: "reconnect_exhausted"',
]) {
  invariant(stateSource.includes(marker), `state marker missing: ${marker}`);
}

for (const marker of [
  "runtime absence degrades safely",
  "connected session survives offline state",
  "bounded reconnect attempts",
  "session expiry is fatal",
  "completed is terminal",
]) {
  invariant(stateTests.includes(marker), `state test missing: ${marker}`);
}

for (const marker of [
  "CandidateInterviewRuntime",
  "navigator.mediaDevices.getUserMedia",
  'requestMedia("full")',
  'requestMedia("audio-only")',
  "remote_video",
  "remote_audio",
  "submitTypedAnswer",
  "startVoiceAnswer",
  "finishVoiceAnswer",
  "SILENCE_TO_SUBMIT_MS",
  "encodePcm16Wav",
  "playTurn",
  "Replay question",
  "Answer by voice",
  "Or type your answer here",
]) {
  invariant(componentSource.includes(marker) || copySource.includes(marker), `candidate room marker missing: ${marker}`);
}
invariant(!componentSource.includes("Start answer"), "engineering Start answer control must not appear in candidate UI");
invariant(!componentSource.includes("Stop answer"), "engineering Stop answer control must not appear in candidate UI");
invariant(!componentSource.includes("setState(\"live\")"), "component must not set live state directly");

for (const marker of [
  "createCandidateRealtimeRuntime",
  "runtime={runtime}",
  'api.GET("/v1/candidate-auth/session")',
  'api.GET("/v1/candidate-consent")',
  "sessionExpiresAt={session.expiresAt}",
]) {
  invariant(pageSource.includes(marker), `candidate page wiring missing: ${marker}`);
}

for (const marker of [
  'from "livekit-client"',
  'const candidateApi = "/api/candidate-interview"',
  "RoomEvent.TrackSubscribed",
  "Track.Source.Microphone",
  "Track.Source.Camera",
  'credentials: "same-origin"',
  '`${candidateApi}/start`',
  '`${candidateApi}/answers/text`',
  '`${candidateApi}/answers/audio?',
  "/turns/${encodeURIComponent(turnId)}/audio",
]) {
  invariant(runtimeSource.includes(marker), `candidate runtime marker missing: ${marker}`);
}

for (const marker of [
  '"cookie"',
  '"content-type"',
  "/v1/candidate-interview/${path.map(encodeURIComponent).join(\"/\")}",
  "request.arrayBuffer()",
]) {
  invariant(proxySource.includes(marker), `candidate proxy marker missing: ${marker}`);
}

const candidateBrowserSurface = `${componentSource}\n${pageSource}\n${runtimeSource}\n${proxySource}`;
for (const forbidden of ["x-organization-id", "x-user-id", "/api/backend/v1/interviews", "/api/backend/v1/interview-media"]) {
  invariant(!candidateBrowserSurface.includes(forbidden), `forbidden internal candidate dependency present: ${forbidden}`);
}

for (const marker of [
  '@Controller("v1/candidate-interview")',
  '@Post("start")',
  '@Post("answers/text")',
  '@Post("answers/audio")',
  '@Post("sessions/:sessionId/media/:mediaSessionId/turns/:turnId/audio")',
  "CANDIDATE_SESSION_COOKIE",
]) {
  invariant(apiControllerSource.includes(marker), `candidate API controller marker missing: ${marker}`);
}

for (const marker of [
  "CandidateSessionService",
  "CandidateConsentService",
  "transcribeAuthenticatedCandidateAudio",
  "synthesizeAuthenticatedCandidateTurn",
  "candidateIsRealCustomerCandidate",
  "appendTranscriptSegment",
  "brain.nextTurn",
]) {
  invariant(apiServiceSource.includes(marker), `candidate API service marker missing: ${marker}`);
}
invariant(!apiControllerSource.includes("x-organization-id"), "candidate controller must not accept tenant headers");
invariant(!apiControllerSource.includes("x-user-id"), "candidate controller must not accept user headers");

for (const marker of [
  "candidate-ui-e2e-camera-denied",
  "Try audio-only",
  "Audio-only fallback is active",
  "Start interview",
  "Network connection is offline",
  "Network connection restored",
]) {
  invariant(e2eSource.includes(marker), `browser evidence marker missing: ${marker}`);
}

for (const marker of [
  "candidate-scoped realtime runtime",
  "typed answers",
  "voice answers",
  "remote interviewer video",
  "must not call recruiter/tenant media endpoints",
  "never renders a fake live state",
]) {
  invariant(docsSource.includes(marker), `documentation marker missing: ${marker}`);
}

invariant(webPackage.dependencies?.["livekit-client"], "web workspace must depend on livekit-client");
invariant(webPackage.scripts?.test === "tsx --test lib/candidate-interview-state.spec.ts", "web reducer test script missing");
invariant(rootPackage.scripts?.["candidate-interview-ui:contract:check"] === "node scripts/check-candidate-interview-ui.mjs", "root contract script missing");
invariant(rootPackage.scripts?.test?.includes("candidate-interview-ui:contract:check"), "root test must enforce candidate interview UI contract");
invariant(rootPackage.scripts?.check?.includes("candidate-interview-ui:contract:check"), "root check must enforce candidate interview UI contract");

console.log("Candidate Interview UI Contract v1 is internally consistent with the candidate-scoped realtime room.");

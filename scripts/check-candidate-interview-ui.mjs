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
invariant(contract.permissions?.microphoneRequired === true, "microphone must remain required");
invariant(contract.permissions?.audioOnlyFallbackAllowed === true, "audio-only fallback must remain available");
invariant(contract.permissions?.getUserMediaRequiresUserAction === true, "media capture must remain user initiated");
invariant(contract.network?.maxReconnectAttempts === 3, "reconnect bound drift");
invariant(contract.runtime?.missingRuntimeState === "degraded", "missing runtime must degrade safely");
invariant(contract.runtime?.onlyRuntimeConnectedEventMayEnterLive === true, "live state provenance drift");
invariant(contract.runtime?.realRealtimeRuntimeRequiredForUiTests === false, "UI tests must remain runtime independent");
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
  "candidateInterviewFallbacks",
  "SESSION_EXPIRED",
  "NETWORK_OFFLINE",
  "NETWORK_ONLINE",
  "Check realtime availability",
]) {
  invariant(componentSource.includes(marker) || copySource.includes(marker), `candidate component marker missing: ${marker}`);
}

const candidateSurface = `${componentSource}\n${pageSource}`;
for (const forbidden of ["/api/backend", "x-organization-id", "x-user-id", "livekit-client"]) {
  invariant(!candidateSurface.includes(forbidden), `forbidden internal candidate dependency present: ${forbidden}`);
}
invariant(pageSource.includes('api.GET("/v1/candidate-auth/session")'), "candidate session API gate missing");
invariant(pageSource.includes('api.GET("/v1/candidate-consent")'), "candidate consent API gate missing");
invariant(pageSource.includes("sessionExpiresAt={session.expiresAt}"), "session expiry must reach the UI state machine");
invariant(!componentSource.includes("setState(\"live\")"), "component must not set live state directly");

for (const marker of [
  "candidate-ui-e2e-camera-denied",
  "Try audio-only",
  "Audio-only fallback is active",
  "Realtime interview service is not available yet.",
  "Resume later with this secure session",
  "Network connection is offline",
  "Network connection restored",
  'toHaveCount(0)',
]) {
  invariant(e2eSource.includes(marker), `browser evidence marker missing: ${marker}`);
}

invariant(docsSource.includes("must not call recruiter/tenant media endpoints"), "security boundary documentation missing");
invariant(docsSource.includes("never renders a fake live state"), "fake-live prohibition documentation missing");
invariant(webPackage.scripts?.test === "tsx --test lib/candidate-interview-state.spec.ts", "web reducer test script missing");
invariant(rootPackage.scripts?.["candidate-interview-ui:contract:check"] === "node scripts/check-candidate-interview-ui.mjs", "root contract script missing");
invariant(rootPackage.scripts?.test?.includes("candidate-interview-ui:contract:check"), "root test must enforce candidate interview UI contract");
invariant(rootPackage.scripts?.check?.includes("candidate-interview-ui:contract:check"), "root check must enforce candidate interview UI contract");

console.log("Candidate Interview UI Contract v1 is internally consistent without requiring a realtime runtime.");

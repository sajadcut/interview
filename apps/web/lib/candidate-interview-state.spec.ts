import assert from "node:assert/strict";
import test from "node:test";
import {
  candidateInterviewFallbacks,
  candidateInterviewReducer,
  canAttemptCandidateInterviewConnection,
  createCandidateInterviewState,
} from "./candidate-interview-state";

function withPermissions(runtimeAvailable = true) {
  let state = createCandidateInterviewState({ runtimeAvailable });
  state = candidateInterviewReducer(state, {
    type: "PERMISSIONS_RESOLVED",
    microphone: "granted",
    camera: "granted",
  });
  return state;
}

test("permissions gate requires a microphone and permits explicit audio-only fallback", () => {
  let state = createCandidateInterviewState({ runtimeAvailable: true });
  state = candidateInterviewReducer(state, {
    type: "PERMISSIONS_RESOLVED",
    microphone: "granted",
    camera: "denied",
  });
  assert.equal(state.phase, "permissions");
  assert.ok(candidateInterviewFallbacks(state).includes("audio_only"));

  state = candidateInterviewReducer(state, { type: "AUDIO_ONLY_SELECTED" });
  assert.equal(state.phase, "ready");
  assert.equal(state.audioOnly, true);
  assert.equal(canAttemptCandidateInterviewConnection(state), true);
});

test("microphone denial never becomes ready through camera fallback", () => {
  let state = createCandidateInterviewState({ runtimeAvailable: true });
  state = candidateInterviewReducer(state, {
    type: "PERMISSIONS_RESOLVED",
    microphone: "denied",
    camera: "granted",
  });
  state = candidateInterviewReducer(state, { type: "AUDIO_ONLY_SELECTED" });
  assert.equal(state.phase, "permissions");
  assert.equal(canAttemptCandidateInterviewConnection(state), false);
  assert.ok(candidateInterviewFallbacks(state).includes("review_permissions"));
});

test("runtime absence degrades safely and never fabricates a live connection", () => {
  let state = withPermissions(false);
  assert.equal(state.phase, "ready");
  state = candidateInterviewReducer(state, { type: "CONNECT_REQUESTED" });
  assert.equal(state.phase, "degraded");
  assert.equal(state.error?.code, "runtime_unavailable");
  assert.equal(state.hasConnected, false);
  assert.ok(candidateInterviewFallbacks(state).includes("resume_later"));
});

test("connected session survives offline state and returns through reconnecting", () => {
  let state = withPermissions(true);
  state = candidateInterviewReducer(state, { type: "CONNECT_REQUESTED" });
  assert.equal(state.phase, "connecting");
  state = candidateInterviewReducer(state, { type: "CONNECTED" });
  assert.equal(state.phase, "live");

  state = candidateInterviewReducer(state, { type: "NETWORK_OFFLINE" });
  assert.equal(state.phase, "offline");
  assert.equal(state.hasConnected, true);
  state = candidateInterviewReducer(state, { type: "NETWORK_ONLINE" });
  assert.equal(state.phase, "reconnecting");
  state = candidateInterviewReducer(state, { type: "TRANSPORT_RECONNECTED" });
  assert.equal(state.phase, "live");
  assert.equal(state.reconnectAttempts, 0);
});

test("pre-connection offline recovery returns to the prior safe phase", () => {
  let state = withPermissions(true);
  state = candidateInterviewReducer(state, { type: "NETWORK_OFFLINE" });
  assert.equal(state.phase, "offline");
  state = candidateInterviewReducer(state, { type: "NETWORK_ONLINE" });
  assert.equal(state.phase, "ready");
});

test("bounded reconnect attempts degrade to resume-later instead of looping forever", () => {
  let state = withPermissions(true);
  state = candidateInterviewReducer(state, { type: "CONNECT_REQUESTED" });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    state = candidateInterviewReducer(state, {
      type: "CONNECTION_FAILED",
      code: "transport_unavailable",
    });
  }
  assert.equal(state.phase, "degraded");
  assert.equal(state.reconnectAttempts, 3);
  assert.equal(state.error?.code, "reconnect_exhausted");
  assert.ok(candidateInterviewFallbacks(state).includes("resume_later"));
  assert.ok(!candidateInterviewFallbacks(state).includes("retry_connection"));
});

test("session expiry is fatal and ignores later transport recovery events", () => {
  let state = withPermissions(true);
  state = candidateInterviewReducer(state, { type: "SESSION_EXPIRED" });
  assert.equal(state.phase, "fatal");
  assert.equal(state.error?.severity, "fatal");
  const recovered = candidateInterviewReducer(state, { type: "CONNECTED" });
  assert.deepEqual(recovered, state);
});

test("completed is terminal and does not reopen after network changes", () => {
  let state = withPermissions(true);
  state = candidateInterviewReducer(state, { type: "COMPLETE" });
  assert.equal(state.phase, "completed");
  const offline = candidateInterviewReducer(state, { type: "NETWORK_OFFLINE" });
  assert.equal(offline.phase, "completed");
});

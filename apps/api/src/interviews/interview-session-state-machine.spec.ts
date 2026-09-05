import assert from "node:assert/strict";
import test from "node:test";
import {
  allowedInterviewSessionActions,
  transitionInterviewSession,
  type InterviewSessionMachineState,
} from "./interview-session-state-machine";

function state(
  status: InterviewSessionMachineState["status"],
  overrides: Partial<InterviewSessionMachineState> = {},
): InterviewSessionMachineState {
  return {
    status,
    reconnectCount: 0,
    recoveryAttemptCount: 0,
    maxReconnects: 3,
    maxRecoveryAttempts: 3,
    resumeStatus: null,
    failureCode: null,
    failureRecoverable: null,
    ...overrides,
  };
}

test("start, pause, resume and finish form a deterministic happy path", () => {
  let current = transitionInterviewSession(state("invited"), { action: "start" });
  assert.equal(current.status, "in_progress");
  current = transitionInterviewSession(current, { action: "pause" });
  assert.equal(current.status, "paused");
  current = transitionInterviewSession(current, { action: "resume" });
  assert.equal(current.status, "in_progress");
  current = transitionInterviewSession(current, { action: "finish" });
  assert.equal(current.status, "completed");
  assert.deepEqual(allowedInterviewSessionActions(current), []);
});

test("disconnect and reconnect restore the active state and count one reconnect", () => {
  const disconnected = transitionInterviewSession(state("in_progress"), { action: "disconnect" });
  assert.equal(disconnected.status, "disconnected");
  assert.equal(disconnected.resumeStatus, "in_progress");
  const reconnected = transitionInterviewSession(disconnected, { action: "reconnect" });
  assert.equal(reconnected.status, "in_progress");
  assert.equal(reconnected.reconnectCount, 1);
  assert.equal(reconnected.resumeStatus, null);
});

test("disconnect while paused reconnects back to paused rather than silently resuming", () => {
  const disconnected = transitionInterviewSession(state("paused"), { action: "disconnect" });
  const reconnected = transitionInterviewSession(disconnected, { action: "reconnect" });
  assert.equal(reconnected.status, "paused");
});

test("recoverable failure preserves resume state and explicit recovery clears the failure", () => {
  const failed = transitionInterviewSession(state("in_progress"), {
    action: "fail",
    failureCode: "transport_timeout",
    recoverable: true,
  });
  assert.equal(failed.status, "disconnected");
  assert.equal(failed.failureCode, "transport_timeout");
  assert.equal(failed.recoveryAttemptCount, 1);
  assert.ok(allowedInterviewSessionActions(failed).includes("recover"));
  assert.ok(!allowedInterviewSessionActions(failed).includes("reconnect"));

  const recovered = transitionInterviewSession(failed, { action: "recover" });
  assert.equal(recovered.status, "in_progress");
  assert.equal(recovered.failureCode, null);
  assert.equal(recovered.recoveryAttemptCount, 0);
  assert.equal(recovered.reconnectCount, 1);
});

test("repeated recoverable failures fail closed after the configured bound", () => {
  let current = transitionInterviewSession(state("in_progress"), {
    action: "fail",
    failureCode: "worker_unavailable",
    recoverable: true,
  });
  current = transitionInterviewSession(current, {
    action: "fail",
    failureCode: "worker_unavailable",
    recoverable: true,
  });
  current = transitionInterviewSession(current, {
    action: "fail",
    failureCode: "worker_unavailable",
    recoverable: true,
  });
  assert.equal(current.status, "failed");
  assert.equal(current.failureCode, "recovery_exhausted");
  assert.equal(current.failureRecoverable, false);
});

test("fatal failure and completion are terminal and cannot be reopened", () => {
  const fatal = transitionInterviewSession(state("in_progress"), {
    action: "fail",
    failureCode: "consent_revoked",
    recoverable: false,
  });
  assert.equal(fatal.status, "failed");
  assert.throws(() => transitionInterviewSession(fatal, { action: "recover" }), /terminal/);

  const completed = transitionInterviewSession(state("in_progress"), { action: "finish" });
  assert.throws(() => transitionInterviewSession(completed, { action: "disconnect" }), /terminal/);
});

test("invalid pause/resume ordering is rejected instead of coerced", () => {
  assert.throws(
    () => transitionInterviewSession(state("invited"), { action: "pause" }),
    /Cannot pause/,
  );
  assert.throws(
    () => transitionInterviewSession(state("in_progress"), { action: "resume" }),
    /Cannot resume/,
  );
});

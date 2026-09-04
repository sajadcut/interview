import assert from "node:assert/strict";
import test from "node:test";
import { SESSION_POLICY, sessionCookieNames } from "./session-policy";

test("production session cookies use standard secure prefixes", () => {
  assert.deepEqual(sessionCookieNames("production"), {
    session: "__Host-interview_session",
    refresh: "__Secure-interview_refresh",
  });
});

test("non-production cookie names remain development-friendly", () => {
  assert.deepEqual(sessionCookieNames("test"), {
    session: "interview_session",
    refresh: "interview_refresh",
  });
  assert.equal(SESSION_POLICY.cookie.httpOnly, true);
  assert.equal(SESSION_POLICY.cookie.sameSite, "strict");
  assert.equal(SESSION_POLICY.cookie.priority, "high");
});

import assert from "node:assert/strict";
import test from "node:test";
import { mediaStatusForEvent } from "./interview-media.service";

test("media lifecycle advances through connecting and connected", () => {
  assert.equal(mediaStatusForEvent("preflight", "connecting"), "connecting");
  assert.equal(mediaStatusForEvent("connecting", "connected"), "connected");
  assert.equal(mediaStatusForEvent("degraded", "reconnected"), "connected");
});

test("disconnect and non-fatal error degrade rather than silently ending the session", () => {
  assert.equal(mediaStatusForEvent("connected", "disconnected"), "degraded");
  assert.equal(mediaStatusForEvent("connected", "error"), "degraded");
});

test("fatal errors fail the media session and terminal states do not reopen", () => {
  assert.equal(mediaStatusForEvent("connected", "error", true), "failed");
  assert.equal(mediaStatusForEvent("ended", "reconnected"), "ended");
  assert.equal(mediaStatusForEvent("failed", "connected"), "failed");
});

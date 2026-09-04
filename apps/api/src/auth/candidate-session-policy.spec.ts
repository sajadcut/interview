import assert from "node:assert/strict";
import test from "node:test";
import { candidateSessionCookieName } from "./candidate-session.service";

test("production candidate session cookie uses the __Host prefix", () => {
  assert.equal(candidateSessionCookieName("production"), "__Host-interview_candidate_session");
});

test("non-production candidate cookie remains development-friendly", () => {
  assert.equal(candidateSessionCookieName("test"), "interview_candidate_session");
});

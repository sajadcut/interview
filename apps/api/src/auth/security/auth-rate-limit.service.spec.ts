import assert from "node:assert/strict";
import test from "node:test";
import { rateLimitKey } from "./auth-rate-limit.service";

test("rate-limit keys are normalized and one-way hashed", () => {
  const first = rateLimitKey(" User@Example.COM ");
  const second = rateLimitKey("user@example.com");
  assert.equal(first, second);
  assert.equal(first.length, 64);
  assert.equal(first.includes("user@example.com"), false);
});

test("different principals receive different rate-limit keys", () => {
  assert.notEqual(rateLimitKey("a@example.com"), rateLimitKey("b@example.com"));
});

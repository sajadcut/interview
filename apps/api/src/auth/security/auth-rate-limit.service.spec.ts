import assert from "node:assert/strict";
import test from "node:test";
import { rateLimitKey } from "./auth-rate-limit.service";

test("rate-limit keys trim transport whitespace and are one-way hashed", () => {
  const first = rateLimitKey(" Token-AbC ");
  const second = rateLimitKey("Token-AbC");
  assert.equal(first, second);
  assert.equal(first.length, 64);
  assert.equal(first.includes("Token-AbC"), false);
});

test("case-sensitive bearer tokens receive distinct rate-limit keys", () => {
  assert.notEqual(rateLimitKey("Token-AbC"), rateLimitKey("token-abc"));
});

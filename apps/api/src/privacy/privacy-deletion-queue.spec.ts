import assert from "node:assert/strict";
import test from "node:test";
import { computePrivacyDeletionRetryDelayMs, privacySubjectDigest } from "./privacy-deletion-queue.service";

test("privacy deletion retry uses bounded exponential backoff", () => {
  assert.equal(computePrivacyDeletionRetryDelayMs(1), 1000);
  assert.equal(computePrivacyDeletionRetryDelayMs(2), 2000);
  assert.equal(computePrivacyDeletionRetryDelayMs(99), 60000);
});

test("privacy subject digest is deterministic and non-reversible-shaped", () => {
  const first = privacySubjectDigest("11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222");
  const second = privacySubjectDigest("11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222");
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.ok(!first.includes("22222222"));
});

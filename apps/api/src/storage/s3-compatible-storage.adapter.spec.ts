import assert from "node:assert/strict";
import test from "node:test";
import { normalizeObjectKey } from "./s3-compatible-storage.adapter";

test("S3-compatible storage normalizes safe object keys", () => {
  assert.equal(normalizeObjectKey("/org/files/report.pdf"), "org/files/report.pdf");
  assert.equal(normalizeObjectKey("org\\files\\report.pdf"), "org/files/report.pdf");
});

test("S3-compatible storage rejects traversal and empty keys", () => {
  assert.throws(() => normalizeObjectKey("../secret"));
  assert.throws(() => normalizeObjectKey("org/../secret"));
  assert.throws(() => normalizeObjectKey("   "));
});

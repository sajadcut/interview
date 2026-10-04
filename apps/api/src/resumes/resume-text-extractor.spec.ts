import assert from "node:assert/strict";
import test from "node:test";
import { toPdfUint8Array } from "./resume-text-extractor";

test("PDF binary normalization converts Node Buffer into a plain Uint8Array", () => {
  const source = Buffer.from("%PDF-test", "utf8");
  const normalized = toPdfUint8Array(source);

  assert.equal(Buffer.isBuffer(normalized), false);
  assert.equal(normalized.constructor, Uint8Array);
  assert.deepEqual([...normalized], [...source]);

  source[0] = 0;
  assert.notEqual(normalized[0], source[0], "normalization must copy the bytes");
});

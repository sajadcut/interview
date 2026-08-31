import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { resolveLocalStoragePath } from "./local-filesystem-storage.adapter";

const root = path.resolve(".local-data/storage-test");

test("local storage path stays inside configured root", () => {
  const resolved = resolveLocalStoragePath(root, "org/file/cv.pdf");
  assert.equal(resolved, path.join(root, "org", "file", "cv.pdf"));
});

test("local storage path rejects traversal", () => {
  assert.throws(() => resolveLocalStoragePath(root, "../../outside.txt"), /Unsafe storage key/);
});

test("local storage path rejects empty and null-byte keys", () => {
  assert.throws(() => resolveLocalStoragePath(root, ""), /Invalid storage key/);
  assert.throws(() => resolveLocalStoragePath(root, "bad\0key"), /Invalid storage key/);
});

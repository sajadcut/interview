import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resetEnvCacheForTests } from "../config/env";
import { LocalFilesystemStorageAdapter, resolveLocalStoragePath } from "./local-filesystem-storage.adapter";

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

test("private disk question-bank bytes survive adapter restart and are deleted only explicitly", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "interview-question-bank-"));
  const original = process.env.LOCAL_STORAGE_ROOT;
  const key = "12345678-1234-4123-8123-123456789012/source/reference.txt";
  const bytes = Buffer.from("Review this approved reference question after service restart.", "utf8");
  try {
    process.env.LOCAL_STORAGE_ROOT = root;
    resetEnvCacheForTests();
    const originalAdapter = new LocalFilesystemStorageAdapter();
    await originalAdapter.put(key, bytes);
    assert.equal(await originalAdapter.exists(key), true);

    // Destroy the instance and create a new provider over the same disk root.
    // A process restart must not rely on an in-memory upload cache.
    const restartedAdapter = new LocalFilesystemStorageAdapter();
    assert.deepEqual(Buffer.from(await restartedAdapter.get(key)), bytes);
    assert.equal(await restartedAdapter.exists(key), true);
    await restartedAdapter.delete(key);
    assert.equal(await originalAdapter.exists(key), false);
  } finally {
    if (original === undefined) delete process.env.LOCAL_STORAGE_ROOT;
    else process.env.LOCAL_STORAGE_ROOT = original;
    resetEnvCacheForTests();
    await rm(root, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { buildCorsOrigins } from "./cors";

test("development CORS includes configured and loopback web origins", () => {
  const origins = buildCorsOrigins("https://example.test", "development");
  assert.deepEqual(
    new Set(origins),
    new Set([
      "https://example.test",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://[::1]:3000",
    ]),
  );
});

test("production CORS keeps only explicitly configured origins", () => {
  const origins = buildCorsOrigins("https://app.example.test, https://admin.example.test", "production");
  assert.deepEqual(origins, ["https://app.example.test", "https://admin.example.test"]);
});

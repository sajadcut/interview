import assert from "node:assert/strict";
import test from "node:test";
import { buildCorsOrigin } from "./cors";

test("CORS keeps only explicitly configured origins", () => {
  const origin = buildCorsOrigin("http://localhost:3000, https://app.example.test, http://localhost:3000");
  assert.deepEqual(origin, ["http://localhost:3000", "https://app.example.test"]);
});

test("CORS wildcard is supported from configuration", () => {
  assert.equal(buildCorsOrigin("*"), "*");
  assert.equal(buildCorsOrigin("https://app.example.test, *"), "*");
});

test("CORS rejects an empty configuration", () => {
  assert.throws(() => buildCorsOrigin(" , "), /CORS_ORIGIN must contain at least one origin or \*/);
});

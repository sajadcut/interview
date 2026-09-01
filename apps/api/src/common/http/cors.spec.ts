import assert from "node:assert/strict";
import test from "node:test";
import { assertProductionCorsPolicy, buildCorsOrigin } from "./cors";

test("CORS keeps only explicitly configured origins", () => {
  const origin = buildCorsOrigin("http://localhost:3000, https://app.example.test, http://localhost:3000");
  assert.deepEqual(origin, ["http://localhost:3000", "https://app.example.test"]);
});

test("CORS wildcard is supported outside production", () => {
  assert.equal(buildCorsOrigin("*"), "*");
  assert.equal(buildCorsOrigin("https://app.example.test, *"), "*");
  assert.doesNotThrow(() => assertProductionCorsPolicy("development", "*"));
});

test("CORS rejects empty, path-bearing and non-http origins", () => {
  assert.throws(() => buildCorsOrigin(" , "), /CORS_ORIGIN must contain at least one origin or \*/);
  assert.throws(() => buildCorsOrigin("https://app.example.test/path"), /origin only/i);
  assert.throws(() => buildCorsOrigin("file:///tmp/interview"), /http:\/\/ or https:\/\//i);
});

test("production CORS fails closed for wildcard and insecure origins", () => {
  assert.throws(() => assertProductionCorsPolicy("production", "*"), /not allowed/i);
  assert.throws(
    () => assertProductionCorsPolicy("production", ["http://hr.example.test"]),
    /https/i,
  );
  assert.doesNotThrow(() =>
    assertProductionCorsPolicy("production", [
      "https://hr.example.test",
      "https://candidate.example.test",
    ]),
  );
});

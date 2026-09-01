import assert from "node:assert/strict";
import test from "node:test";
import { evaluateCsrfProtection } from "./csrf.middleware";

const origins = ["https://hr.example.test", "https://candidate.example.test"];

test("CSRF allows safe methods without requiring an origin", () => {
  for (const method of ["GET", "HEAD", "OPTIONS"]) {
    assert.deepEqual(
      evaluateCsrfProtection({
        method,
        cookieAuthenticated: true,
        configuredOrigins: origins,
      }),
      { allowed: true },
    );
  }
});

test("CSRF allows non-cookie authenticated state changes", () => {
  assert.deepEqual(
    evaluateCsrfProtection({
      method: "POST",
      cookieAuthenticated: false,
      configuredOrigins: origins,
    }),
    { allowed: true },
  );
});

test("CSRF rejects cookie-authenticated mutations with a missing origin", () => {
  const decision = evaluateCsrfProtection({
    method: "POST",
    cookieAuthenticated: true,
    configuredOrigins: origins,
  });
  assert.equal(decision.allowed, false);
  if (!decision.allowed) assert.match(decision.message, /Origin header is required/);
});

test("CSRF rejects wildcard and foreign origins for cookie-authenticated mutations", () => {
  const wildcard = evaluateCsrfProtection({
    method: "PATCH",
    cookieAuthenticated: true,
    origin: "https://hr.example.test",
    configuredOrigins: "*",
  });
  assert.equal(wildcard.allowed, false);

  const foreign = evaluateCsrfProtection({
    method: "DELETE",
    cookieAuthenticated: true,
    origin: "https://evil.example.test",
    configuredOrigins: origins,
  });
  assert.equal(foreign.allowed, false);
});

test("CSRF allows an exact configured origin for cookie-authenticated mutations", () => {
  assert.deepEqual(
    evaluateCsrfProtection({
      method: "POST",
      cookieAuthenticated: true,
      origin: "https://candidate.example.test",
      configuredOrigins: origins,
    }),
    { allowed: true },
  );
});

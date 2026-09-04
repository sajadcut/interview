import assert from "node:assert/strict";
import test from "node:test";
import { securityHeadersFor } from "./security-headers.middleware";

test("API responses use a deny-by-default CSP without inline script allowances", () => {
  const headers = securityHeadersFor("/v1/jobs", false);
  assert.equal(
    headers["content-security-policy"],
    "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; object-src 'none'",
  );
  assert.doesNotMatch(headers["content-security-policy"] ?? "", /unsafe-inline/);
  assert.equal(headers["x-frame-options"], "DENY");
  assert.equal(headers["referrer-policy"], "no-referrer");
});

test("Swagger keeps only the inline allowances required by its own documentation UI", () => {
  const headers = securityHeadersFor("/docs", false);
  assert.match(headers["content-security-policy"] ?? "", /script-src 'self' 'unsafe-inline'/);
  assert.match(headers["content-security-policy"] ?? "", /frame-ancestors 'none'/);
});

test("sensitive endpoints are explicitly non-cacheable", () => {
  for (const path of [
    "/auth/login",
    "/v1/candidate-auth/session",
    "/v1/candidates/123",
    "/v1/interviews/123",
    "/v1/privacy/requests",
    "/internal/privacy-worker/claim",
  ]) {
    const headers = securityHeadersFor(path, false);
    assert.match(headers["cache-control"] ?? "", /no-store/);
    assert.equal(headers.pragma, "no-cache");
  }
});

test("HSTS is emitted only in production", () => {
  assert.equal(securityHeadersFor("/health", false)["strict-transport-security"], undefined);
  assert.equal(
    securityHeadersFor("/health", true)["strict-transport-security"],
    "max-age=63072000; includeSubDomains; preload",
  );
});

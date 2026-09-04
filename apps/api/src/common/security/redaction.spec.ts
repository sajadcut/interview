import assert from "node:assert/strict";
import test from "node:test";
import {
  REDACTED_VALUE,
  isSensitiveKey,
  redactSensitiveString,
  redactSensitiveValue,
} from "./redaction";

test("sensitive-key detection avoids non-secret token counters", () => {
  assert.equal(isSensitiveKey("refreshToken"), true);
  assert.equal(isSensitiveKey("client_secret"), true);
  assert.equal(isSensitiveKey("authorizationHeader"), true);
  assert.equal(isSensitiveKey("promptTokens"), false);
  assert.equal(isSensitiveKey("completionTokens"), false);
});

test("redaction recursively removes structured credentials without losing safe fields", () => {
  const value = redactSensitiveValue({
    email: "candidate@example.invalid",
    password: "dont-log-me",
    nested: {
      refreshToken: "refresh-secret",
      promptTokens: 123,
      headers: { authorization: "Bearer raw-token" },
    },
  }) as Record<string, unknown>;

  assert.equal(value.password, REDACTED_VALUE);
  assert.equal((value.nested as Record<string, unknown>).refreshToken, REDACTED_VALUE);
  assert.equal((value.nested as Record<string, unknown>).promptTokens, 123);
  assert.equal(
    ((value.nested as Record<string, unknown>).headers as Record<string, unknown>).authorization,
    REDACTED_VALUE,
  );
});

test("redaction removes bearer credentials, auth cookies and sensitive query parameters from strings", () => {
  const redacted = redactSensitiveString(
    "Authorization: Bearer abcdefghijklmnop https://example.invalid/cb?token=raw-token&ok=1 interview_session=session-value",
  );
  assert.doesNotMatch(redacted, /abcdefghijklmnop|raw-token|session-value/);
  assert.match(redacted, /\[REDACTED\]/);
  assert.match(redacted, /ok=1/);
});

test("redaction handles errors and circular structures without throwing", () => {
  const circular: Record<string, unknown> = { apiKey: "key-value" };
  circular.self = circular;
  const result = redactSensitiveValue({
    error: new Error("request failed token=super-secret"),
    circular,
  });
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /super-secret|key-value/);
  assert.match(serialized, /\[Circular\]/);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  assertProductionSecretPolicy,
  constantTimeSecretMatch,
  sharedSecretIssue,
} from "./secrets";

test("shared-secret policy requires stronger values in production", () => {
  assert.equal(sharedSecretIssue("test-secret", "test"), undefined);
  assert.match(sharedSecretIssue("short", "test") ?? "", /at least 8/);
  assert.match(sharedSecretIssue("x".repeat(31), "production") ?? "", /at least 32/);
  assert.equal(sharedSecretIssue("x".repeat(32), "production"), undefined);
  assert.match(sharedSecretIssue("changeme", "production") ?? "", /at least 32|placeholder/);
});

test("constant-time comparison uses fixed-size digests for equal and unequal secret lengths", () => {
  assert.equal(constantTimeSecretMatch("alpha-secret", "alpha-secret"), true);
  assert.equal(constantTimeSecretMatch("alpha-secret", "different-secret"), false);
  assert.equal(constantTimeSecretMatch("short", "a-much-longer-secret-value"), false);
});

test("production bootstrap rejects enabled realtime media without a strong worker secret", () => {
  assert.throws(
    () =>
      assertProductionSecretPolicy({
        NODE_ENV: "production",
        MEDIA_REALTIME_ENABLED: "true",
      }),
    /MEDIA_WORKER_SHARED_SECRET/,
  );

  assert.doesNotThrow(() =>
    assertProductionSecretPolicy({
      NODE_ENV: "production",
      MEDIA_REALTIME_ENABLED: "true",
      MEDIA_WORKER_SHARED_SECRET: "m".repeat(32),
    }),
  );
});

test("production bootstrap rejects explicit placeholder provider credentials", () => {
  assert.throws(
    () =>
      assertProductionSecretPolicy({
        NODE_ENV: "production",
        SENDGRID_API_KEY: "changeme",
      }),
    /SENDGRID_API_KEY/,
  );
});

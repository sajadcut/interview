import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { AuthController } from "../auth.controller";
import { CandidateAuthController } from "../candidate-auth.controller";
import {
  SENSITIVE_RATE_LIMIT_METADATA,
  SENSITIVE_RATE_LIMIT_PRESETS,
  type SensitiveRateLimitRule,
} from "./sensitive-rate-limit.decorator";

function rulesFor(handler: object): readonly SensitiveRateLimitRule[] {
  const value: unknown = Reflect.getMetadata(SENSITIVE_RATE_LIMIT_METADATA, handler);
  assert.ok(Array.isArray(value), "endpoint must carry sensitive rate-limit metadata");
  return value as readonly SensitiveRateLimitRule[];
}

test("sensitive auth endpoints carry the expected rate-limit presets", () => {
  assert.deepEqual(rulesFor(AuthController.prototype.login), SENSITIVE_RATE_LIMIT_PRESETS.login);
  assert.deepEqual(
    rulesFor(AuthController.prototype.requestPasswordReset),
    SENSITIVE_RATE_LIMIT_PRESETS.passwordResetRequest,
  );
  assert.deepEqual(
    rulesFor(AuthController.prototype.resetPassword),
    SENSITIVE_RATE_LIMIT_PRESETS.passwordResetComplete,
  );
  assert.deepEqual(rulesFor(AuthController.prototype.refresh), SENSITIVE_RATE_LIMIT_PRESETS.refresh);

  assert.deepEqual(
    rulesFor(CandidateAuthController.prototype.createInvitation),
    SENSITIVE_RATE_LIMIT_PRESETS.candidateInvitation,
  );
  assert.deepEqual(
    rulesFor(CandidateAuthController.prototype.validateMagicLink),
    SENSITIVE_RATE_LIMIT_PRESETS.candidateMagicLink,
  );
  assert.deepEqual(
    rulesFor(CandidateAuthController.prototype.verifyOtp),
    SENSITIVE_RATE_LIMIT_PRESETS.candidateOtp,
  );
});

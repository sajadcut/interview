import { SetMetadata } from "@nestjs/common";
import type { AuthRateLimitPolicyName } from "./auth-rate-limit.service";

export const SENSITIVE_RATE_LIMIT_METADATA = "auth:sensitive-rate-limit";

export type SensitiveRateLimitKeySource =
  | "ip"
  | "body-token"
  | "refresh-token"
  | "tenant-application"
  | "tenant-ip";

export interface SensitiveRateLimitRule {
  scope: string;
  policy: AuthRateLimitPolicyName;
  source: SensitiveRateLimitKeySource;
}

export const SENSITIVE_RATE_LIMIT_PRESETS = {
  login: [
    { scope: "login-ip-aggregate", policy: "loginIpAggregate", source: "ip" },
  ],
  passwordResetRequest: [
    { scope: "password-reset-ip", policy: "passwordResetIp", source: "ip" },
  ],
  passwordResetComplete: [
    { scope: "password-reset-token", policy: "passwordResetToken", source: "body-token" },
    { scope: "password-reset-complete-ip", policy: "passwordResetIp", source: "ip" },
  ],
  refresh: [
    { scope: "refresh-token", policy: "refreshToken", source: "refresh-token" },
    { scope: "refresh-ip", policy: "refreshIp", source: "ip" },
  ],
  candidateInvitation: [
    {
      scope: "candidate-invitation-application",
      policy: "candidateInvitationApplication",
      source: "tenant-application",
    },
    {
      scope: "candidate-invitation-ip",
      policy: "candidateInvitationIp",
      source: "tenant-ip",
    },
  ],
  candidateMagicLink: [
    { scope: "candidate-magic-token", policy: "candidateMagicToken", source: "body-token" },
    { scope: "candidate-token-ip", policy: "candidateTokenIp", source: "ip" },
  ],
  candidateOtp: [
    { scope: "candidate-otp-ip", policy: "candidateOtpIp", source: "ip" },
  ],
} as const satisfies Record<string, readonly SensitiveRateLimitRule[]>;

export type SensitiveRateLimitPreset = keyof typeof SENSITIVE_RATE_LIMIT_PRESETS;

export function SensitiveRateLimit(preset: SensitiveRateLimitPreset) {
  return SetMetadata(SENSITIVE_RATE_LIMIT_METADATA, SENSITIVE_RATE_LIMIT_PRESETS[preset]);
}

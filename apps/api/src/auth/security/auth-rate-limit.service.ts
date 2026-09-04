import { createHash } from "node:crypto";
import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";

export interface RateLimitPolicy {
  maxAttempts: number;
  windowSeconds: number;
  blockSeconds: number;
}

export interface RateLimitState {
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  resetAt: string;
}

export const AUTH_RATE_LIMIT_POLICIES = {
  loginEmail: { maxAttempts: 10, windowSeconds: 15 * 60, blockSeconds: 15 * 60 },
  loginIp: { maxAttempts: 30, windowSeconds: 15 * 60, blockSeconds: 15 * 60 },
  loginIpAggregate: { maxAttempts: 60, windowSeconds: 15 * 60, blockSeconds: 15 * 60 },
  passwordReset: { maxAttempts: 5, windowSeconds: 60 * 60, blockSeconds: 60 * 60 },
  passwordResetIp: { maxAttempts: 20, windowSeconds: 60 * 60, blockSeconds: 60 * 60 },
  passwordResetToken: { maxAttempts: 6, windowSeconds: 15 * 60, blockSeconds: 30 * 60 },
  refreshToken: { maxAttempts: 40, windowSeconds: 5 * 60, blockSeconds: 15 * 60 },
  refreshIp: { maxAttempts: 120, windowSeconds: 5 * 60, blockSeconds: 15 * 60 },
  candidateMagicToken: { maxAttempts: 12, windowSeconds: 15 * 60, blockSeconds: 30 * 60 },
  candidateTokenIp: { maxAttempts: 40, windowSeconds: 15 * 60, blockSeconds: 30 * 60 },
  candidateOtp: { maxAttempts: 6, windowSeconds: 10 * 60, blockSeconds: 30 * 60 },
  candidateOtpIp: { maxAttempts: 30, windowSeconds: 10 * 60, blockSeconds: 30 * 60 },
  candidateInvitationApplication: { maxAttempts: 6, windowSeconds: 60 * 60, blockSeconds: 60 * 60 },
  candidateInvitationIp: { maxAttempts: 60, windowSeconds: 60 * 60, blockSeconds: 60 * 60 },
} as const satisfies Record<string, RateLimitPolicy>;

export type AuthRateLimitPolicyName = keyof typeof AUTH_RATE_LIMIT_POLICIES;

export function rateLimitKey(value: string): string {
  return createHash("sha256").update(value.trim(), "utf8").digest("hex");
}

function validatePolicy(scope: string, rawKey: string, policy: RateLimitPolicy): void {
  if (!scope.trim() || scope.length > 48) throw new Error("Rate-limit scope must be between 1 and 48 characters");
  if (!rawKey.trim()) throw new Error(`Rate-limit key is required for scope ${scope}`);
  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1 || policy.maxAttempts > 10_000) {
    throw new Error(`Invalid maxAttempts for rate-limit scope ${scope}`);
  }
  if (!Number.isInteger(policy.windowSeconds) || policy.windowSeconds < 1 || policy.windowSeconds > 86_400) {
    throw new Error(`Invalid windowSeconds for rate-limit scope ${scope}`);
  }
  if (!Number.isInteger(policy.blockSeconds) || policy.blockSeconds < 1 || policy.blockSeconds > 86_400) {
    throw new Error(`Invalid blockSeconds for rate-limit scope ${scope}`);
  }
}

export class RateLimitExceededException extends HttpException {
  constructor(state: RateLimitState) {
    super(
      {
        message: "Too many requests; try again later",
        code: "RATE_LIMITED",
        retryAfterSeconds: state.retryAfterSeconds,
        limit: state.limit,
        remaining: 0,
        resetAt: state.resetAt,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

@Injectable()
export class AuthRateLimitService {
  constructor(private readonly database: DatabaseService) {}

  async consume(scope: string, rawKey: string, policy: RateLimitPolicy): Promise<RateLimitState> {
    validatePolicy(scope, rawKey, policy);
    const keyHash = rateLimitKey(rawKey);

    const state = await this.database.sql.begin(async (tx) => {
      // One atomic UPSERT serializes both existing buckets and concurrent first requests.
      // SELECT ... FOR UPDATE is insufficient when the bucket row does not exist yet.
      const rows = await tx`
        INSERT INTO auth_rate_limits (
          scope, key_hash, window_started_at, attempts, blocked_until, updated_at
        ) VALUES (
          ${scope}, ${keyHash}, statement_timestamp(), 1, NULL, statement_timestamp()
        )
        ON CONFLICT (scope, key_hash) DO UPDATE
        SET attempts = CASE
              WHEN auth_rate_limits.blocked_until IS NOT NULL
                AND auth_rate_limits.blocked_until > statement_timestamp()
                THEN LEAST(auth_rate_limits.attempts::bigint + 1, 2147483647)::integer
              WHEN auth_rate_limits.window_started_at
                <= statement_timestamp() - (${policy.windowSeconds} * interval '1 second')
                THEN 1
              ELSE LEAST(auth_rate_limits.attempts::bigint + 1, 2147483647)::integer
            END,
            window_started_at = CASE
              WHEN auth_rate_limits.blocked_until IS NOT NULL
                AND auth_rate_limits.blocked_until > statement_timestamp()
                THEN auth_rate_limits.window_started_at
              WHEN auth_rate_limits.window_started_at
                <= statement_timestamp() - (${policy.windowSeconds} * interval '1 second')
                THEN statement_timestamp()
              ELSE auth_rate_limits.window_started_at
            END,
            blocked_until = CASE
              WHEN auth_rate_limits.blocked_until IS NOT NULL
                AND auth_rate_limits.blocked_until > statement_timestamp()
                THEN auth_rate_limits.blocked_until
              ELSE NULL
            END,
            updated_at = statement_timestamp()
        RETURNING attempts, window_started_at, blocked_until
      `;
      const row = rows[0];
      if (!row) throw new Error(`Rate-limit bucket update returned no row for scope ${scope}`);

      let blockedUntil = row.blocked_until ? new Date(String(row.blocked_until)) : null;
      const attempts = Number(row.attempts);
      if (!Number.isFinite(attempts)) throw new Error(`Invalid attempt count for rate-limit scope ${scope}`);

      const currentTime = Date.now();
      const alreadyBlocked =
        blockedUntil !== null &&
        !Number.isNaN(blockedUntil.getTime()) &&
        blockedUntil.getTime() > currentTime;

      if (!alreadyBlocked && attempts > policy.maxAttempts) {
        const blockedRows = await tx`
          UPDATE auth_rate_limits
          SET blocked_until = statement_timestamp() + (${policy.blockSeconds} * interval '1 second'),
              updated_at = statement_timestamp()
          WHERE scope = ${scope} AND key_hash = ${keyHash}
          RETURNING blocked_until
        `;
        const value = blockedRows[0]?.blocked_until;
        if (!value) throw new Error(`Failed to persist blocked_until for rate-limit scope ${scope}`);
        blockedUntil = new Date(String(value));
      }

      const windowStartedAt = new Date(String(row.window_started_at));
      if (Number.isNaN(windowStartedAt.getTime())) {
        throw new Error(`Invalid window timestamp for rate-limit scope ${scope}`);
      }

      const resetAt =
        blockedUntil && blockedUntil.getTime() > Date.now()
          ? blockedUntil
          : new Date(windowStartedAt.getTime() + policy.windowSeconds * 1000);
      const retryAfterSeconds =
        blockedUntil && blockedUntil.getTime() > Date.now()
          ? Math.max(1, Math.ceil((blockedUntil.getTime() - Date.now()) / 1000))
          : 0;

      return {
        limit: policy.maxAttempts,
        remaining: Math.max(0, policy.maxAttempts - attempts),
        retryAfterSeconds,
        resetAt: resetAt.toISOString(),
        blocked: retryAfterSeconds > 0,
      };
    });

    if (state.blocked) {
      throw new RateLimitExceededException({
        limit: state.limit,
        remaining: 0,
        retryAfterSeconds: state.retryAfterSeconds,
        resetAt: state.resetAt,
      });
    }

    return {
      limit: state.limit,
      remaining: state.remaining,
      retryAfterSeconds: 0,
      resetAt: state.resetAt,
    };
  }

  async clear(scope: string, rawKey: string): Promise<void> {
    if (!rawKey.trim()) return;
    await this.database.sql`
      DELETE FROM auth_rate_limits
      WHERE scope = ${scope} AND key_hash = ${rateLimitKey(rawKey)}
    `;
  }
}

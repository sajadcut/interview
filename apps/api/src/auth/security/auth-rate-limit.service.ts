import { Injectable, TooManyRequestsException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { DatabaseService } from "../../database/database.service";

export interface RateLimitPolicy {
  maxAttempts: number;
  windowSeconds: number;
  blockSeconds: number;
}

export const AUTH_RATE_LIMIT_POLICIES = {
  loginEmail: { maxAttempts: 10, windowSeconds: 15 * 60, blockSeconds: 15 * 60 },
  loginIp: { maxAttempts: 30, windowSeconds: 15 * 60, blockSeconds: 15 * 60 },
  candidateOtp: { maxAttempts: 6, windowSeconds: 10 * 60, blockSeconds: 30 * 60 },
  passwordReset: { maxAttempts: 5, windowSeconds: 60 * 60, blockSeconds: 60 * 60 },
} as const satisfies Record<string, RateLimitPolicy>;

export function rateLimitKey(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

@Injectable()
export class AuthRateLimitService {
  constructor(private readonly database: DatabaseService) {}

  async consume(scope: string, rawKey: string, policy: RateLimitPolicy): Promise<void> {
    if (!rawKey.trim()) return;
    const keyHash = rateLimitKey(rawKey);
    const now = new Date();

    const result = await this.database.sql.begin(async (tx) => {
      const rows = await tx`
        SELECT attempts, window_started_at, blocked_until
        FROM auth_rate_limits
        WHERE scope = ${scope} AND key_hash = ${keyHash}
        FOR UPDATE
      `;
      const row = rows[0];
      const blockedUntil = row?.blocked_until ? new Date(String(row.blocked_until)) : null;
      if (blockedUntil && blockedUntil.getTime() > now.getTime()) {
        return { blocked: true, retryAfterSeconds: Math.max(1, Math.ceil((blockedUntil.getTime() - now.getTime()) / 1000)) };
      }

      const windowStartedAt = row?.window_started_at
        ? new Date(String(row.window_started_at))
        : null;
      const windowExpired =
        !windowStartedAt ||
        Number.isNaN(windowStartedAt.getTime()) ||
        now.getTime() - windowStartedAt.getTime() >= policy.windowSeconds * 1000;
      const nextAttempts = windowExpired ? 1 : Number(row?.attempts ?? 0) + 1;
      const nextWindow = windowExpired ? now : windowStartedAt;
      const shouldBlock = nextAttempts > policy.maxAttempts;
      const nextBlockedUntil = shouldBlock
        ? new Date(now.getTime() + policy.blockSeconds * 1000)
        : null;

      await tx`
        INSERT INTO auth_rate_limits (
          scope, key_hash, window_started_at, attempts, blocked_until, updated_at
        ) VALUES (
          ${scope}, ${keyHash}, ${nextWindow}, ${nextAttempts}, ${nextBlockedUntil}, now()
        )
        ON CONFLICT (scope, key_hash) DO UPDATE
        SET window_started_at = EXCLUDED.window_started_at,
            attempts = EXCLUDED.attempts,
            blocked_until = EXCLUDED.blocked_until,
            updated_at = now()
      `;

      return {
        blocked: shouldBlock,
        retryAfterSeconds: shouldBlock ? policy.blockSeconds : 0,
      };
    });

    if (result.blocked) {
      throw new TooManyRequestsException({
        message: "Too many authentication attempts; try again later",
        retryAfterSeconds: result.retryAfterSeconds,
      });
    }
  }

  async clear(scope: string, rawKey: string): Promise<void> {
    if (!rawKey.trim()) return;
    await this.database.sql`
      DELETE FROM auth_rate_limits
      WHERE scope = ${scope} AND key_hash = ${rateLimitKey(rawKey)}
    `;
  }
}

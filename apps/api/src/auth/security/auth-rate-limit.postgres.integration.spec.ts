import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import type { DatabaseService } from "../../database/database.service";
import {
  AuthRateLimitService,
  RateLimitExceededException,
  rateLimitKey,
} from "./auth-rate-limit.service";

const integrationDatabaseUrl = process.env.AUTH_INTEGRATION_DATABASE_URL;

function createIntegrationDatabase(): DatabaseService {
  if (!integrationDatabaseUrl) {
    throw new Error("AUTH_INTEGRATION_DATABASE_URL is required for PostgreSQL integration tests");
  }
  const sql = postgres(integrationDatabaseUrl, {
    max: 12,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return {
    sql,
    onModuleDestroy: async () => {
      await sql.end({ timeout: 5 });
    },
  } as DatabaseService;
}

test(
  "rate limiter atomically counts concurrent first requests and persists blocked attempts",
  { skip: !integrationDatabaseUrl },
  async () => {
    const database = createIntegrationDatabase();
    const limiter = new AuthRateLimitService(database);
    const scope = `test-${randomUUID().slice(0, 8)}`;
    const rawKey = `Token-${randomUUID()}`;
    const policy = { maxAttempts: 5, windowSeconds: 60, blockSeconds: 60 };

    try {
      const outcomes = await Promise.allSettled(
        Array.from({ length: 20 }, () => limiter.consume(scope, rawKey, policy)),
      );
      assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 5);
      const rejected = outcomes.filter(
        (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
      );
      assert.equal(rejected.length, 15);
      assert.ok(
        rejected.every(
          (outcome) =>
            outcome.reason instanceof RateLimitExceededException &&
            outcome.reason.getStatus() === 429,
        ),
      );

      const rows = await database.sql`
        SELECT key_hash, attempts, blocked_until
        FROM auth_rate_limits
        WHERE scope = ${scope}
      `;
      assert.equal(rows.length, 1);
      assert.equal(Number(rows[0]?.attempts), 20);
      assert.ok(rows[0]?.blocked_until);
      assert.equal(String(rows[0]?.key_hash), rateLimitKey(rawKey));
      assert.notEqual(String(rows[0]?.key_hash), rawKey);
    } finally {
      await database.sql`DELETE FROM auth_rate_limits WHERE scope = ${scope}`;
      await database.onModuleDestroy();
    }
  },
);

test(
  "rate limiter clear resets a bucket and token hashing remains case-sensitive",
  { skip: !integrationDatabaseUrl },
  async () => {
    const database = createIntegrationDatabase();
    const limiter = new AuthRateLimitService(database);
    const scope = `case-${randomUUID().slice(0, 8)}`;
    const upperToken = `AbC-${randomUUID()}`;
    const lowerToken = upperToken.toLowerCase();
    const policy = { maxAttempts: 1, windowSeconds: 60, blockSeconds: 60 };

    try {
      assert.notEqual(rateLimitKey(upperToken), rateLimitKey(lowerToken));
      await limiter.consume(scope, upperToken, policy);
      await assert.rejects(
        () => limiter.consume(scope, upperToken, policy),
        (error: unknown) => error instanceof RateLimitExceededException,
      );

      await limiter.clear(scope, upperToken);
      const afterClear = await limiter.consume(scope, upperToken, policy);
      assert.equal(afterClear.remaining, 0);

      const rows = await database.sql`
        SELECT key_hash, attempts
        FROM auth_rate_limits
        WHERE scope = ${scope}
      `;
      assert.equal(rows.length, 1);
      assert.equal(Number(rows[0]?.attempts), 1);
      assert.equal(String(rows[0]?.key_hash), rateLimitKey(upperToken));
    } finally {
      await database.sql`DELETE FROM auth_rate_limits WHERE scope = ${scope}`;
      await database.onModuleDestroy();
    }
  },
);

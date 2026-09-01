import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import type { DatabaseService } from "../database/database.service";
import { EnterpriseAuthService } from "./enterprise-auth.service";
import { PasswordHasherService } from "./password-hasher.service";
import { AuthRateLimitService } from "./security/auth-rate-limit.service";
import { SessionService } from "./session.service";

const integrationDatabaseUrl = process.env.AUTH_INTEGRATION_DATABASE_URL;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function createIntegrationDatabase(): DatabaseService {
  if (!integrationDatabaseUrl) {
    throw new Error("AUTH_INTEGRATION_DATABASE_URL is required for PostgreSQL integration tests");
  }
  const sql = postgres(integrationDatabaseUrl, {
    max: 1,
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
  "enterprise auth persists sessions and rotates refresh tokens against PostgreSQL",
  { skip: !integrationDatabaseUrl },
  async () => {
    const database = createIntegrationDatabase();
    const hasher = new PasswordHasherService();
    const sessions = new SessionService(database);
    const rateLimits = new AuthRateLimitService(database);
    const auth = new EnterpriseAuthService(database, hasher, sessions, rateLimits);
    const userId = randomUUID();
    const email = `auth-integration-${userId}@example.invalid`;
    const password = "correct horse battery staple";

    try {
      await database.sql`
        INSERT INTO users (id, email, display_name)
        VALUES (${userId}::uuid, ${email}, 'Auth Integration Test')
      `;
      await auth.setPassword(userId, password);

      const login = await auth.login(email, password, {
        ip: "127.0.0.1",
        userAgent: "auth-postgres-integration-test",
      });
      const initialSessionRows = await database.sql`
        SELECT token_hash, revoked_at
        FROM sessions
        WHERE id = ${login.sessionId}::uuid
      `;
      assert.equal(initialSessionRows.length, 1);
      assert.equal(String(initialSessionRows[0]?.token_hash), sha256(login.sessionToken));
      assert.notEqual(String(initialSessionRows[0]?.token_hash), login.sessionToken);
      assert.equal(initialSessionRows[0]?.revoked_at, null);

      const initialRefreshRows = await database.sql`
        SELECT id::text AS id, token_hash, family_id::text AS family_id, revoked_at, rotated_to_id
        FROM refresh_tokens
        WHERE session_id = ${login.sessionId}::uuid
        ORDER BY created_at ASC
      `;
      assert.equal(initialRefreshRows.length, 1);
      assert.equal(String(initialRefreshRows[0]?.token_hash), sha256(login.refreshToken));
      assert.notEqual(String(initialRefreshRows[0]?.token_hash), login.refreshToken);

      const rotated = await sessions.rotateRefreshToken(login.refreshToken, {
        ip: "127.0.0.2",
        userAgent: "auth-postgres-integration-test-rotated",
      });
      assert.equal(rotated.sessionId, login.sessionId);
      assert.notEqual(rotated.sessionToken, login.sessionToken);
      assert.notEqual(rotated.refreshToken, login.refreshToken);

      const refreshRowsAfterRotation = await database.sql`
        SELECT token_hash, family_id::text AS family_id, revoked_at, rotated_to_id
        FROM refresh_tokens
        WHERE session_id = ${login.sessionId}::uuid
        ORDER BY created_at ASC
      `;
      assert.equal(refreshRowsAfterRotation.length, 2);
      assert.equal(refreshRowsAfterRotation[0]?.revoked_at instanceof Date, true);
      assert.ok(refreshRowsAfterRotation[0]?.rotated_to_id);
      assert.equal(
        String(refreshRowsAfterRotation[0]?.family_id),
        String(refreshRowsAfterRotation[1]?.family_id),
      );
      assert.equal(String(refreshRowsAfterRotation[1]?.token_hash), sha256(rotated.refreshToken));

      const principal = await sessions.resolveInternalSession(rotated.sessionToken);
      assert.deepEqual(principal, { userId, sessionId: login.sessionId });

      await sessions.revoke(rotated.sessionToken);
      assert.equal(await sessions.resolveInternalSession(rotated.sessionToken), undefined);
    } finally {
      await database.sql`DELETE FROM users WHERE id = ${userId}::uuid`;
      await database.onModuleDestroy();
    }
  },
);

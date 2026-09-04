import assert from "node:assert/strict";
import test from "node:test";
import type { DatabaseService } from "../database/database.service";
import { EnterpriseAuthService } from "./enterprise-auth.service";
import { PasswordHasherService } from "./password-hasher.service";
import { AuthRateLimitService } from "./security/auth-rate-limit.service";
import { SessionService } from "./session.service";

interface SqlCall {
  text: string;
  values: unknown[];
}

type TestSql = ((strings: TemplateStringsArray, ...values: unknown[]) => Promise<Record<string, unknown>[]>) & {
  begin<T>(callback: (transaction: TestSql) => Promise<T>): Promise<T>;
  json(value: unknown): unknown;
};

function databaseStub(passwordHash: string): { database: DatabaseService; calls: SqlCall[] } {
  const calls: SqlCall[] = [];
  const sql: TestSql = Object.assign(
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = Array.from(strings).join("?");
      calls.push({ text, values });
      if (text.includes("INSERT INTO auth_rate_limits")) {
        return [
          {
            attempts: 1,
            window_started_at: new Date(),
            blocked_until: null,
          },
        ];
      }
      if (text.includes("FROM users u") && text.includes("JOIN credentials c")) {
        return [
          {
            user_id: "11111111-1111-4111-8111-111111111111",
            email: "admin@example.com",
            display_name: "Admin",
            disabled_at: null,
            password_hash: passwordHash,
            failed_login_count: 0,
            locked_until: null,
          },
        ];
      }
      return [];
    },
    {
      begin: async <T>(callback: (transaction: TestSql) => Promise<T>) => callback(sql),
      json: (value: unknown) => value,
    },
  );
  return { database: { sql } as unknown as DatabaseService, calls };
}

test("enterprise auth login verifies Argon2id and persists only token hashes", async () => {
  const hasher = new PasswordHasherService();
  const password = "correct horse battery staple";
  const passwordHash = await hasher.hashPassword(password);
  const { database, calls } = databaseStub(passwordHash);
  const sessions = new SessionService(database);
  const rateLimits = new AuthRateLimitService(database);
  const auth = new EnterpriseAuthService(database, hasher, sessions, rateLimits);

  const result = await auth.login("ADMIN@example.com", password, {
    ip: "127.0.0.1",
    userAgent: "integration-test",
  });

  assert.equal(result.userId, "11111111-1111-4111-8111-111111111111");
  assert.equal(result.email, "admin@example.com");
  assert.ok(result.sessionToken.length >= 40);
  assert.ok(result.refreshToken.length >= 60);

  const persistedValues = calls.flatMap((call) => call.values).map(String);
  assert.equal(persistedValues.includes(result.sessionToken), false);
  assert.equal(persistedValues.includes(result.refreshToken), false);
  assert.ok(calls.some((call) => call.text.includes("INSERT INTO sessions")));
  assert.ok(calls.some((call) => call.text.includes("INSERT INTO refresh_tokens")));
});

test("enterprise auth increments failed-login state on invalid password", async () => {
  const hasher = new PasswordHasherService();
  const passwordHash = await hasher.hashPassword("correct horse battery staple");
  const { database, calls } = databaseStub(passwordHash);
  const sessions = new SessionService(database);
  const rateLimits = new AuthRateLimitService(database);
  const auth = new EnterpriseAuthService(database, hasher, sessions, rateLimits);

  await assert.rejects(
    () => auth.login("admin@example.com", "definitely-wrong-password"),
    /Invalid email or password/,
  );
  assert.ok(
    calls.some(
      (call) =>
        call.text.includes("UPDATE credentials") && call.text.includes("failed_login_count = failed_login_count + 1"),
    ),
  );
});
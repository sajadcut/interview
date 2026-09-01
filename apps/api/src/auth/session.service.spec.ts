import assert from "node:assert/strict";
import test from "node:test";
import type { DatabaseService } from "../database/database.service";
import { SessionService } from "./session.service";

interface SqlCall {
  text: string;
  values: unknown[];
}

type TestSql = ((strings: TemplateStringsArray, ...values: unknown[]) => Promise<Record<string, unknown>[]>) & {
  begin<T>(callback: (transaction: TestSql) => Promise<T>): Promise<T>;
  json(value: unknown): unknown;
};

function sessionDatabaseStub(reused = false): { database: DatabaseService; calls: SqlCall[] } {
  const calls: SqlCall[] = [];
  let sql!: TestSql;
  sql = Object.assign(
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = Array.from(strings).join("?");
      calls.push({ text, values });
      if (text.includes("FROM refresh_tokens rt")) {
        return [
          {
            refresh_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            session_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            family_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            expires_at: new Date(Date.now() + 60_000),
            revoked_at: reused ? new Date() : null,
            rotated_to_id: reused ? "dddddddd-dddd-4ddd-8ddd-dddddddddddd" : null,
            user_id: "11111111-1111-4111-8111-111111111111",
            session_revoked_at: null,
            disabled_at: null,
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

test("refresh rotation issues new session and refresh secrets and revokes the predecessor", async () => {
  const { database, calls } = sessionDatabaseStub();
  const service = new SessionService(database);
  const issued = await service.rotateRefreshToken("previous-refresh-token", {
    ip: "127.0.0.1",
    userAgent: "integration-test",
  });

  assert.equal(issued.userId, "11111111-1111-4111-8111-111111111111");
  assert.notEqual(issued.refreshToken, "previous-refresh-token");
  assert.ok(calls.some((call) => call.text.includes("INSERT INTO refresh_tokens")));
  assert.ok(calls.some((call) => call.text.includes("rotated_to_id")));
  assert.ok(calls.some((call) => call.text.includes("UPDATE sessions")));
});

test("refresh token reuse revokes the token family and session", async () => {
  const { database, calls } = sessionDatabaseStub(true);
  const service = new SessionService(database);

  await assert.rejects(
    () => service.rotateRefreshToken("replayed-refresh-token"),
    /Refresh token reuse detected/,
  );
  assert.ok(
    calls.some(
      (call) => call.text.includes("UPDATE refresh_tokens") && call.text.includes("WHERE family_id"),
    ),
  );
  assert.ok(
    calls.some((call) => call.text.includes("UPDATE sessions") && call.text.includes("revoked_at")),
  );
});

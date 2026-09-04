import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";

const integrationDatabaseUrl = process.env.AUTH_INTEGRATION_DATABASE_URL;

test(
  "audit_events redact nested credentials at the PostgreSQL boundary",
  { skip: !integrationDatabaseUrl },
  async () => {
    if (!integrationDatabaseUrl) return;
    const sql = postgres(integrationDatabaseUrl, {
      max: 1,
      idle_timeout: 20,
      connect_timeout: 10,
    });
    const organizationId = randomUUID();
    const userId = randomUUID();
    try {
      await sql`
        INSERT INTO organizations (id, name, slug)
        VALUES (${organizationId}::uuid, 'Audit Redaction Integration', ${`audit-redaction-${organizationId}`})
      `;
      await sql`
        INSERT INTO users (id, email, display_name)
        VALUES (${userId}::uuid, ${`audit-redaction-${userId}@example.invalid`}, 'Audit Redaction Test')
      `;
      await sql`
        INSERT INTO audit_events (
          organization_id, actor_type, actor_user_id, action, entity_type, metadata, "before", "after"
        ) VALUES (
          ${organizationId}::uuid,
          'user',
          ${userId}::uuid,
          'security.redaction.test',
          'security_test',
          ${sql.json({
            refreshToken: 'raw-refresh-token',
            promptTokens: 123,
            nested: { client_secret: 'raw-client-secret' },
          } as never)},
          ${sql.json({ password: 'raw-password' } as never)},
          ${sql.json({ safe: true, authorizationHeader: 'Bearer raw-bearer' } as never)}
        )
      `;

      const rows = await sql`
        SELECT metadata, "before", "after"
        FROM audit_events
        WHERE organization_id = ${organizationId}::uuid
          AND action = 'security.redaction.test'
        LIMIT 1
      `;
      assert.equal(rows.length, 1);
      const metadata = rows[0]?.metadata as Record<string, unknown>;
      const before = rows[0]?.before as Record<string, unknown>;
      const after = rows[0]?.after as Record<string, unknown>;
      assert.equal(metadata.refreshToken, '[REDACTED]');
      assert.equal(metadata.promptTokens, 123);
      assert.equal((metadata.nested as Record<string, unknown>).client_secret, '[REDACTED]');
      assert.equal(before.password, '[REDACTED]');
      assert.equal(after.authorizationHeader, '[REDACTED]');
      assert.doesNotMatch(JSON.stringify(rows[0]), /raw-refresh-token|raw-client-secret|raw-password|raw-bearer/);
    } finally {
      await sql`DELETE FROM organizations WHERE id = ${organizationId}::uuid`;
      await sql`DELETE FROM users WHERE id = ${userId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
);

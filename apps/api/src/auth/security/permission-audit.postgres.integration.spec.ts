import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import type { DatabaseService } from "../../database/database.service";
import { TenantContextService } from "../../tenant/tenant-context.service";
import { AuthContextService } from "../auth-context.service";
import { Permissions } from "../permissions";
import { PermissionAuditService } from "./permission-audit.service";

const integrationDatabaseUrl = process.env.AUTH_INTEGRATION_DATABASE_URL;

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
  "permission audit persists a tenant-scoped privileged grant without query-string leakage",
  { skip: !integrationDatabaseUrl },
  async () => {
    const database = createIntegrationDatabase();
    const tenantContext = new TenantContextService();
    const authContext = new AuthContextService();
    const audit = new PermissionAuditService(database, tenantContext, authContext);
    const organizationId = randomUUID();
    const userId = randomUUID();

    try {
      await database.sql`
        INSERT INTO organizations (id, name, slug)
        VALUES (${organizationId}::uuid, 'Permission Audit Integration', ${`permission-audit-${organizationId}`})
      `;
      await database.sql`
        INSERT INTO users (id, email, display_name)
        VALUES (${userId}::uuid, ${`permission-audit-${userId}@example.invalid`}, 'Permission Audit Test')
      `;

      await tenantContext.run(organizationId, () =>
        authContext.run({ userId, source: "development-header" }, () =>
          audit.recordGranted({
            required: [Permissions.PrivacyManage],
            request: {
              method: "POST",
              path: "/v1/privacy/requests",
              originalUrl: "/v1/privacy/requests?token=must-not-be-stored",
              requestId: "permission-audit-integration",
            },
            access: {
              organizationId,
              userId,
              membershipId: null,
              platformAdmin: true,
              permissions: new Set([Permissions.PrivacyManage]),
            },
          }),
        ),
      );

      const rows = await database.sql`
        SELECT action, entity_type, actor_user_id::text AS actor_user_id, metadata
        FROM audit_events
        WHERE organization_id = ${organizationId}::uuid
          AND action = 'authorization.permission.granted'
        ORDER BY created_at DESC
        LIMIT 1
      `;
      assert.equal(rows.length, 1);
      assert.equal(String(rows[0]?.actor_user_id), userId);
      assert.equal(String(rows[0]?.entity_type), "permission_check");
      const metadata = rows[0]?.metadata as Record<string, unknown>;
      assert.equal(metadata.path, "/v1/privacy/requests");
      assert.equal(metadata.requestId, "permission-audit-integration");
      assert.deepEqual(metadata.requiredPermissions, [Permissions.PrivacyManage]);
      assert.doesNotMatch(JSON.stringify(metadata), /must-not-be-stored/);
    } finally {
      await database.sql`DELETE FROM organizations WHERE id = ${organizationId}::uuid`;
      await database.sql`DELETE FROM users WHERE id = ${userId}::uuid`;
      await database.onModuleDestroy();
    }
  },
);

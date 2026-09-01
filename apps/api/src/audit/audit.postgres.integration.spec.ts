import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import type { AuthContextService } from "../auth/auth-context.service";
import type { DatabaseService } from "../database/database.service";
import type { TenantContextService } from "../tenant/tenant-context.service";
import { AuditService } from "./audit.service";

const integrationDatabaseUrl = process.env.AUTH_INTEGRATION_DATABASE_URL;

function createIntegrationDatabase(): DatabaseService {
  if (!integrationDatabaseUrl) {
    throw new Error("AUTH_INTEGRATION_DATABASE_URL is required for PostgreSQL integration tests");
  }
  const sql = postgres(integrationDatabaseUrl, { max: 1, idle_timeout: 20, connect_timeout: 10 });
  return {
    sql,
    onModuleDestroy: async () => {
      await sql.end({ timeout: 5 });
    },
  } as DatabaseService;
}

function tenantContext(organizationId: string): TenantContextService {
  return { require: () => ({ organizationId }) } as TenantContextService;
}

test(
  "audit export never returns another tenant's events and reports truncation",
  { skip: !integrationDatabaseUrl },
  async () => {
    const database = createIntegrationDatabase();
    const organizationA = randomUUID();
    const organizationB = randomUUID();
    const audit = new AuditService(
      database,
      tenantContext(organizationA),
      { getOptional: () => undefined } as AuthContextService,
    );

    try {
      await database.sql`
        INSERT INTO organizations (id, name, slug) VALUES
          (${organizationA}::uuid, 'Audit Tenant A', ${`audit-a-${organizationA}`}),
          (${organizationB}::uuid, 'Audit Tenant B', ${`audit-b-${organizationB}`})
      `;
      await database.sql`
        INSERT INTO audit_events (organization_id, actor_type, action, entity_type, entity_id, metadata)
        VALUES
          (${organizationA}::uuid, 'system', 'candidate.view', 'candidate', 'a-1', ${database.sql.json({ tenant: "A", n: 1 } as never)}),
          (${organizationA}::uuid, 'system', 'candidate.view', 'candidate', 'a-2', ${database.sql.json({ tenant: "A", n: 2 } as never)}),
          (${organizationB}::uuid, 'system', 'candidate.view', 'candidate', 'b-1', ${database.sql.json({ tenant: "B" } as never)})
      `;

      const limited = await audit.exportEvents({ action: "candidate.view", limit: 1 });
      assert.equal(limited.organizationId, organizationA);
      assert.equal(limited.count, 1);
      assert.equal(limited.truncated, true);
      assert.ok(limited.events.every((event) => event.entityId?.startsWith("a-")));

      const complete = await audit.exportEvents({ action: "candidate.view", limit: 10 });
      assert.equal(complete.count, 2);
      assert.equal(complete.truncated, false);
      assert.deepEqual(
        new Set(complete.events.map((event) => event.entityId)),
        new Set(["a-1", "a-2"]),
      );
      assert.ok(complete.events.every((event) => event.metadata?.tenant === "A"));

      await assert.rejects(
        () => audit.exportEvents({ from: "2026-09-02T00:00:00.000Z", to: "2026-09-01T00:00:00.000Z" }),
        /from.*before or equal/i,
      );
    } finally {
      await database.sql`DELETE FROM organizations WHERE id IN (${organizationA}::uuid, ${organizationB}::uuid)`;
      await database.onModuleDestroy();
    }
  },
);

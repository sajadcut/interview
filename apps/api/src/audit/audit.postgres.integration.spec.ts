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
  "audit export is complete-by-default, tenant isolated, decision aware, redacted and integrity stamped",
  { skip: !integrationDatabaseUrl },
  async () => {
    const database = createIntegrationDatabase();
    const organizationA = randomUUID();
    const organizationB = randomUUID();
    const userA = randomUUID();
    const userB = randomUUID();
    const jobA = randomUUID();
    const jobB = randomUUID();
    const candidateA = randomUUID();
    const candidateB = randomUUID();
    const applicationA = randomUUID();
    const applicationB = randomUUID();
    const audit = new AuditService(
      database,
      tenantContext(organizationA),
      { getOptional: () => ({ userId: userA }) } as AuthContextService,
    );

    try {
      await database.sql`
        INSERT INTO organizations (id, name, slug) VALUES
          (${organizationA}::uuid, 'Audit Tenant A', ${`audit-a-${organizationA}`}),
          (${organizationB}::uuid, 'Audit Tenant B', ${`audit-b-${organizationB}`})
      `;
      await database.sql`
        INSERT INTO users (id, email, display_name) VALUES
          (${userA}::uuid, ${`audit-a-${userA}@example.test`}, 'Audit User A'),
          (${userB}::uuid, ${`audit-b-${userB}@example.test`}, 'Audit User B')
      `;
      await database.sql`
        INSERT INTO jobs (id, organization_id, title, status) VALUES
          (${jobA}::uuid, ${organizationA}::uuid, 'Audit Job A', 'open'),
          (${jobB}::uuid, ${organizationB}::uuid, 'Audit Job B', 'open')
      `;
      await database.sql`
        INSERT INTO candidates (id, organization_id, display_name) VALUES
          (${candidateA}::uuid, ${organizationA}::uuid, 'Audit Candidate A'),
          (${candidateB}::uuid, ${organizationB}::uuid, 'Audit Candidate B')
      `;
      await database.sql`
        INSERT INTO applications (id, organization_id, job_id, candidate_id, pipeline_stage) VALUES
          (${applicationA}::uuid, ${organizationA}::uuid, ${jobA}::uuid, ${candidateA}::uuid, 'screening'),
          (${applicationB}::uuid, ${organizationB}::uuid, ${jobB}::uuid, ${candidateB}::uuid, 'screening')
      `;

      await database.sql`
        INSERT INTO audit_events (organization_id, actor_type, action, entity_type, entity_id, metadata)
        VALUES
          (
            ${organizationA}::uuid,
            'system',
            'candidate.view',
            'candidate',
            ${candidateA},
            ${database.sql.json({ tenant: "A", apiToken: "must-not-export", nested: { password: "hidden" } } as never)}
          ),
          (
            ${organizationB}::uuid,
            'system',
            'candidate.view',
            'candidate',
            ${candidateB},
            ${database.sql.json({ tenant: "B" } as never)}
          )
      `;
      await database.sql`
        INSERT INTO recruitment_events (
          organization_id, application_id, job_id, candidate_id, event_type, stage, source, metadata
        ) VALUES
          (${organizationA}::uuid, ${applicationA}::uuid, ${jobA}::uuid, ${candidateA}::uuid, 'screen_completed', 'screening', 'integration-test', ${database.sql.json({ tenant: "A" } as never)}),
          (${organizationB}::uuid, ${applicationB}::uuid, ${jobB}::uuid, ${candidateB}::uuid, 'screen_completed', 'screening', 'integration-test', ${database.sql.json({ tenant: "B" } as never)})
      `;
      await database.sql`
        INSERT INTO application_stage_transitions (
          organization_id, application_id, from_stage, to_stage, reason, actor_user_id
        ) VALUES (
          ${organizationA}::uuid,
          ${applicationA}::uuid,
          'screening',
          'interview',
          'Qualified after structured screening',
          ${userA}::uuid
        )
      `;
      await database.sql`
        INSERT INTO hiring_decisions (
          organization_id, application_id, decision, reason, actor_user_id, metadata
        ) VALUES
          (${organizationA}::uuid, ${applicationA}::uuid, 'advance', 'Evidence supports interview', ${userA}::uuid, ${database.sql.json({ tenant: "A" } as never)}),
          (${organizationB}::uuid, ${applicationB}::uuid, 'reject', 'Other tenant decision', ${userB}::uuid, ${database.sql.json({ tenant: "B" } as never)})
      `;
      await database.sql`
        INSERT INTO ai_executions (
          organization_id, capability, provider, model, prompt_version, status, input_references, structured_output
        ) VALUES
          (${organizationA}::uuid, 'candidate_summary', 'test-provider', 'test-model', 'v1', 'succeeded', ${database.sql.json({ candidateId: candidateA } as never)}, ${database.sql.json({ summary: 'A' } as never)}),
          (${organizationB}::uuid, 'candidate_summary', 'test-provider', 'test-model', 'v1', 'succeeded', ${database.sql.json({ candidateId: candidateB } as never)}, ${database.sql.json({ summary: 'B' } as never)})
      `;
      await database.sql`
        INSERT INTO retention_jobs (organization_id, cycle_key, state, dry_run, result)
        VALUES (
          ${organizationA}::uuid,
          ${`audit-test-${organizationA}`},
          'succeeded',
          true,
          ${database.sql.json({ previewed: 3 } as never)}
        )
      `;

      const complete = await audit.exportEvents({});
      assert.equal(complete.organizationId, organizationA);
      assert.equal(complete.truncated, false);
      assert.ok(complete.count >= 6);
      assert.ok(complete.events.every((event) => event.metadata?.tenant !== "B"));
      assert.ok(complete.events.some((event) => event.action === "hiring.decision_recorded"));
      assert.ok(complete.events.some((event) => event.action === "application.stage_changed"));
      assert.ok(complete.events.some((event) => event.action === "ai.execution"));
      assert.ok(complete.events.some((event) => event.action === "retention.cycle"));

      const explicitAudit = complete.events.find((event) => event.action === "candidate.view");
      assert.ok(explicitAudit);
      assert.equal(explicitAudit.metadata?.apiToken, "[REDACTED]");
      assert.equal(
        (explicitAudit.metadata?.nested as Record<string, unknown> | undefined)?.password,
        "[REDACTED]",
      );

      const manifest = complete.filters.manifest;
      assert.equal(manifest.exportVersion, "2.0");
      assert.equal(manifest.completeByDefault, true);
      assert.match(manifest.integrity.digest, /^[a-f0-9]{64}$/);
      assert.ok(Number(manifest.sourceCounts.audit_events) >= 1);
      assert.ok(Number(manifest.sourceCounts.hiring_decisions) >= 1);

      const limited = await audit.exportEvents({ limit: 1 });
      assert.equal(limited.count, 1);
      assert.equal(limited.truncated, true);
      assert.equal(limited.filters.manifest.completeByDefault, false);

      const decisionOnly = await audit.exportEvents({ action: "hiring.decision_recorded" });
      assert.equal(decisionOnly.count, 1);
      assert.equal(decisionOnly.events[0]?.entityId, applicationA);

      await assert.rejects(
        () => audit.exportEvents({ from: "2026-09-02T00:00:00.000Z", to: "2026-09-01T00:00:00.000Z" }),
        /from.*before or equal/i,
      );
    } finally {
      await database.sql`DELETE FROM organizations WHERE id IN (${organizationA}::uuid, ${organizationB}::uuid)`;
      await database.sql`DELETE FROM users WHERE id IN (${userA}::uuid, ${userB}::uuid)`;
      await database.onModuleDestroy();
    }
  },
);

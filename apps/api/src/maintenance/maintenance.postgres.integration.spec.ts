import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import type { AuthContextService } from "../auth/auth-context.service";
import type { DatabaseService } from "../database/database.service";
import type { TenantContextService } from "../tenant/tenant-context.service";
import { MaintenanceService } from "./maintenance.service";

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

function authContext(userId: string): AuthContextService {
  return { getOptional: () => ({ userId, sessionId: randomUUID() }) } as AuthContextService;
}

test(
  "privacy deletion is dry-run by default, idempotent, and blocked by legal hold",
  { skip: !integrationDatabaseUrl },
  async () => {
    const database = createIntegrationDatabase();
    const organizationId = randomUUID();
    const userId = randomUUID();
    const candidateId = randomUUID();
    const requestId = randomUUID();
    const service = new MaintenanceService(
      database,
      tenantContext(organizationId),
      authContext(userId),
    );

    try {
      await database.sql`
        INSERT INTO organizations (id, name, slug)
        VALUES (${organizationId}::uuid, 'Maintenance Integration', ${`maintenance-${organizationId}`})
      `;
      await database.sql`
        INSERT INTO users (id, email, display_name)
        VALUES (${userId}::uuid, ${`maintenance-${userId}@example.invalid`}, 'Maintenance Reviewer')
      `;
      await database.sql`
        INSERT INTO candidates (id, organization_id, display_name, primary_email)
        VALUES (${candidateId}::uuid, ${organizationId}::uuid, 'Deletion Candidate', 'delete@example.invalid')
      `;
      await database.sql`
        INSERT INTO privacy_requests (
          id, organization_id, candidate_id, request_type, status, reviewed_by_user_id, review_notes
        ) VALUES (
          ${requestId}::uuid, ${organizationId}::uuid, ${candidateId}::uuid,
          'deletion', 'approved_pending_execution', ${userId}::uuid, 'Identity verified and deletion approved'
        )
      `;

      const hold = await service.createLegalHold({
        candidateId,
        reason: "Preserve candidate record during investigation",
      });
      await assert.rejects(
        () => service.executePrivacyDeletion(requestId, { idempotencyKey: `delete:${requestId}:blocked` }),
        /active legal hold/i,
      );

      await service.releaseLegalHold(hold.id);
      const preview = await service.executePrivacyDeletion(requestId, {
        idempotencyKey: `delete:${requestId}:preview`,
      });
      assert.equal(preview.dryRun, true);
      assert.equal(preview.state, "succeeded");
      assert.equal(preview.result.deleted, false);

      const replay = await service.executePrivacyDeletion(requestId, {
        idempotencyKey: `delete:${requestId}:preview`,
      });
      assert.equal(replay.id, preview.id);

      const candidateAfterPreview = await database.sql`
        SELECT id FROM candidates
        WHERE organization_id = ${organizationId}::uuid AND id = ${candidateId}::uuid
      `;
      assert.equal(candidateAfterPreview.length, 1);

      const execution = await service.executePrivacyDeletion(requestId, {
        dryRun: false,
        idempotencyKey: `delete:${requestId}:execute`,
      });
      assert.equal(execution.dryRun, false);
      assert.equal(execution.state, "succeeded");
      assert.equal(execution.result.deleted, true);

      const candidateAfterExecution = await database.sql`
        SELECT id FROM candidates
        WHERE organization_id = ${organizationId}::uuid AND id = ${candidateId}::uuid
      `;
      assert.equal(candidateAfterExecution.length, 0);

      const receipts = await database.sql`
        SELECT candidate_reference_hash, deletion_summary
        FROM privacy_deletion_receipts
        WHERE organization_id = ${organizationId}::uuid
          AND privacy_request_id = ${requestId}::uuid
      `;
      assert.equal(receipts.length, 1);
      assert.equal(String(receipts[0]?.candidate_reference_hash).length, 64);
      assert.equal(
        (receipts[0]?.deletion_summary as Record<string, unknown> | undefined)?.deleted,
        true,
      );
    } finally {
      await database.sql`DELETE FROM organizations WHERE id = ${organizationId}::uuid`;
      await database.sql`DELETE FROM users WHERE id = ${userId}::uuid`;
      await database.onModuleDestroy();
    }
  },
);

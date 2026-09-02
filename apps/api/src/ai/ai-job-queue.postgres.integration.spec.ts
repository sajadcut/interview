import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import type { DatabaseService } from "../database/database.service";
import { AiJobQueueService } from "./ai-job-queue.service";

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

test(
  "AI worker queue persists idempotency, retry, lease ownership and completion",
  { skip: !integrationDatabaseUrl },
  async () => {
    const database = createIntegrationDatabase();
    const organizationId = randomUUID();
    const service = new AiJobQueueService(database);

    try {
      await database.sql`
        INSERT INTO organizations (id, name, slug)
        VALUES (${organizationId}::uuid, 'AI Worker Integration', ${`ai-worker-${organizationId}`})
      `;

      const first = await service.enqueue({
        organizationId,
        capability: "system.healthcheck",
        payload: { probe: true },
        idempotencyKey: "healthcheck-1",
        maxAttempts: 3,
        retryBaseMs: 100,
        retryMaxMs: 1000,
      });
      const replay = await service.enqueue({
        organizationId,
        capability: "system.healthcheck",
        payload: { probe: false },
        idempotencyKey: "healthcheck-1",
      });
      assert.equal(replay.id, first.id);

      const claimed = await service.claim("integration-worker", 5000);
      assert.equal(claimed?.id, first.id);
      assert.equal(claimed?.status, "running");
      assert.equal(claimed?.attemptCount, 1);
      assert.ok(claimed?.leaseToken);

      const retry = await service.fail({
        jobId: claimed!.id,
        leaseToken: claimed!.leaseToken!,
        workerId: "integration-worker",
        retryable: true,
        errorCode: "TEMPORARY_TEST_FAILURE",
        errorMessage: "retry me",
      });
      assert.equal(retry.status, "retry_scheduled");
      assert.equal(retry.lastErrorCode, "TEMPORARY_TEST_FAILURE");

      await database.sql`
        UPDATE ai_jobs SET available_at = now() WHERE id = ${first.id}::uuid
      `;
      const reclaimed = await service.claim("integration-worker", 5000);
      assert.equal(reclaimed?.id, first.id);
      assert.equal(reclaimed?.attemptCount, 2);
      assert.notEqual(reclaimed?.leaseToken, claimed?.leaseToken);

      await assert.rejects(() =>
        service.complete(first.id, claimed!.leaseToken!, "integration-worker", { stale: true }),
      );

      const completed = await service.complete(
        first.id,
        reclaimed!.leaseToken!,
        "integration-worker",
        { ok: true },
      );
      assert.equal(completed.status, "succeeded");
      assert.deepEqual(completed.result, { ok: true });

      const expiring = await service.enqueue({
        organizationId,
        capability: "system.healthcheck",
        idempotencyKey: "lease-expiry-1",
        maxAttempts: 1,
      });
      const expiringClaim = await service.claim("integration-worker", 5000);
      assert.equal(expiringClaim?.id, expiring.id);
      await database.sql`
        UPDATE ai_jobs SET lease_expires_at = now() - interval '1 second'
        WHERE id = ${expiring.id}::uuid
      `;
      assert.equal(await service.claim("integration-worker", 5000), null);
      const expiredRows = await database.sql`
        SELECT status, last_error_code FROM ai_jobs WHERE id = ${expiring.id}::uuid
      `;
      assert.equal(expiredRows[0]?.status, "dead_letter");
      assert.equal(expiredRows[0]?.last_error_code, "LEASE_EXPIRED");

      const events = await database.sql`
        SELECT event_type FROM ai_job_events
        WHERE organization_id = ${organizationId}::uuid AND ai_job_id = ${first.id}::uuid
        ORDER BY created_at ASC
      `;
      assert.deepEqual(
        events.map((row) => row.event_type),
        ["enqueued", "claimed", "retry_scheduled", "claimed", "succeeded"],
      );
    } finally {
      await database.sql`DELETE FROM organizations WHERE id = ${organizationId}::uuid`;
      await database.onModuleDestroy();
    }
  },
);

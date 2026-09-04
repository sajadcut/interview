import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import type { DatabaseService } from "../database/database.service";
import { RetentionQueueService } from "./retention-queue.service";

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
  "automatic retention is dry-run safe, idempotent, legal-hold aware and delegates candidate erasure",
  { skip: !integrationDatabaseUrl },
  async () => {
    const database = createIntegrationDatabase();
    const queue = new RetentionQueueService(database);
    const organizationId = randomUUID();
    const jobId = randomUUID();
    const candidateId = randomUUID();
    const heldCandidateId = randomUUID();
    const activeCandidateId = randomUUID();
    const oldEventId = randomUUID();
    const heldEventId = randomUUID();
    const freshEventId = randomUUID();
    const oldDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const freshDate = new Date();

    try {
      await database.sql`
        INSERT INTO organizations (id, name, slug)
        VALUES (
          ${organizationId}::uuid,
          'Retention Integration',
          ${`retention-${organizationId}`}
        )
      `;
      await database.sql`
        INSERT INTO jobs (id, organization_id, title, status, created_at, updated_at)
        VALUES (
          ${jobId}::uuid,
          ${organizationId}::uuid,
          'Retention Test Job',
          'open',
          ${oldDate},
          ${oldDate}
        )
      `;
      await database.sql`
        INSERT INTO candidates (id, organization_id, display_name, created_at, updated_at)
        VALUES
          (${candidateId}::uuid, ${organizationId}::uuid, 'Expired Candidate', ${oldDate}, ${oldDate}),
          (${heldCandidateId}::uuid, ${organizationId}::uuid, 'Held Candidate', ${oldDate}, ${oldDate}),
          (${activeCandidateId}::uuid, ${organizationId}::uuid, 'Active Candidate', ${oldDate}, ${oldDate})
      `;
      await database.sql`
        INSERT INTO applications (
          organization_id, job_id, candidate_id, status, pipeline_stage, created_at, updated_at
        ) VALUES (
          ${organizationId}::uuid,
          ${jobId}::uuid,
          ${activeCandidateId}::uuid,
          'active',
          'interview',
          ${oldDate},
          ${oldDate}
        )
      `;
      await database.sql`
        INSERT INTO legal_holds (organization_id, candidate_id, reason, status)
        VALUES (
          ${organizationId}::uuid,
          ${heldCandidateId}::uuid,
          'Retention integration legal hold',
          'active'
        )
      `;
      await database.sql`
        INSERT INTO recruitment_events (
          id, organization_id, event_type, occurred_at, created_at
        ) VALUES
          (${oldEventId}::uuid, ${organizationId}::uuid, 'retention_old', ${oldDate}, ${oldDate}),
          (${heldEventId}::uuid, ${organizationId}::uuid, 'retention_held', ${oldDate}, ${oldDate}),
          (${freshEventId}::uuid, ${organizationId}::uuid, 'retention_fresh', ${freshDate}, ${freshDate})
      `;
      await database.sql`
        INSERT INTO legal_holds (
          organization_id, entity_type, entity_id, reason, status
        ) VALUES (
          ${organizationId}::uuid,
          'recruitment_event',
          ${heldEventId}::uuid,
          'Preserve held recruiting event',
          'active'
        )
      `;
      await database.sql`
        INSERT INTO retention_policies (
          organization_id, entity_type, retention_days, enabled
        ) VALUES
          (${organizationId}::uuid, 'candidates', 30, true),
          (${organizationId}::uuid, 'recruitment_events', 30, true)
      `;

      const previewCycle = `preview:${randomUUID()}`;
      const previewSchedule = await queue.schedule(previewCycle);
      assert.equal(previewSchedule.dryRun, true);
      assert.equal(previewSchedule.scheduledCount, 1);
      const replaySchedule = await queue.schedule(previewCycle);
      assert.equal(replaySchedule.scheduledCount, 0);

      const previewJob = await queue.claim("retention-integration-preview", 120000);
      assert.ok(previewJob);
      const previewResult = await queue.execute(
        previewJob.jobId,
        previewJob.leaseToken,
        "retention-integration-preview",
      );
      assert.equal(previewResult.dryRun, true);

      const afterPreview = await database.sql`
        SELECT id::text FROM recruitment_events
        WHERE organization_id = ${organizationId}::uuid
          AND id IN (${oldEventId}::uuid, ${heldEventId}::uuid, ${freshEventId}::uuid)
      `;
      assert.equal(afterPreview.length, 3);
      const previewRequests = await database.sql`
        SELECT id FROM privacy_requests
        WHERE organization_id = ${organizationId}::uuid
          AND metadata->>'source' = 'retention'
      `;
      assert.equal(previewRequests.length, 0);

      const executeCycle = `execute:${randomUUID()}`;
      const executeSchedule = await queue.schedule(executeCycle, false);
      assert.equal(executeSchedule.scheduledCount, 1);
      const executionJob = await queue.claim("retention-integration-execute", 120000);
      assert.ok(executionJob);
      const execution = await queue.execute(
        executionJob.jobId,
        executionJob.leaseToken,
        "retention-integration-execute",
      );
      assert.equal(execution.dryRun, false);
      assert.equal(execution.state, "succeeded");

      const events = await database.sql`
        SELECT id::text
        FROM recruitment_events
        WHERE organization_id = ${organizationId}::uuid
          AND id IN (${oldEventId}::uuid, ${heldEventId}::uuid, ${freshEventId}::uuid)
        ORDER BY id
      `;
      const eventIds = new Set(events.map((row) => String(row.id)));
      assert.equal(eventIds.has(oldEventId), false);
      assert.equal(eventIds.has(heldEventId), true);
      assert.equal(eventIds.has(freshEventId), true);

      const links = await database.sql`
        SELECT candidate_id::text, privacy_request_id::text
        FROM retention_candidate_deletions
        WHERE organization_id = ${organizationId}::uuid
          AND retention_job_id = ${executionJob.jobId}::uuid
      `;
      assert.equal(links.length, 1);
      assert.equal(String(links[0]?.candidate_id), candidateId);
      assert.ok(links[0]?.privacy_request_id);

      const requests = await database.sql`
        SELECT id::text, candidate_id::text, status, metadata, subject_digest
        FROM privacy_requests
        WHERE organization_id = ${organizationId}::uuid
          AND id = ${String(links[0]?.privacy_request_id)}::uuid
      `;
      assert.equal(requests.length, 1);
      assert.equal(String(requests[0]?.candidate_id), candidateId);
      assert.equal(String(requests[0]?.status), "approved_pending_execution");
      assert.equal((requests[0]?.metadata as Record<string, unknown>).source, "retention");
      assert.equal(String(requests[0]?.subject_digest).length, 64);

      const deletionJobs = await database.sql`
        SELECT state, candidate_id::text
        FROM privacy_deletion_jobs
        WHERE organization_id = ${organizationId}::uuid
          AND privacy_request_id = ${String(links[0]?.privacy_request_id)}::uuid
      `;
      assert.equal(deletionJobs.length, 1);
      assert.equal(String(deletionJobs[0]?.state), "queued");
      assert.equal(String(deletionJobs[0]?.candidate_id), candidateId);

      const candidates = await database.sql`
        SELECT id::text
        FROM candidates
        WHERE organization_id = ${organizationId}::uuid
          AND id IN (
            ${candidateId}::uuid,
            ${heldCandidateId}::uuid,
            ${activeCandidateId}::uuid
          )
      `;
      assert.equal(candidates.length, 3);

      const items = await database.sql`
        SELECT entity_type, status, eligible_count, deleted_count, held_count, delegated_count
        FROM retention_job_items
        WHERE organization_id = ${organizationId}::uuid
          AND retention_job_id = ${executionJob.jobId}::uuid
        ORDER BY entity_type
      `;
      assert.equal(items.length, 2);
      const candidateItem = items.find((row) => String(row.entity_type) === "candidates");
      const eventItem = items.find((row) => String(row.entity_type) === "recruitment_events");
      assert.equal(Number(candidateItem?.eligible_count), 1);
      assert.equal(Number(candidateItem?.held_count), 1);
      assert.equal(Number(candidateItem?.delegated_count), 1);
      assert.equal(Number(eventItem?.eligible_count), 1);
      assert.equal(Number(eventItem?.held_count), 1);
      assert.equal(Number(eventItem?.deleted_count), 1);
    } finally {
      await database.sql`DELETE FROM organizations WHERE id = ${organizationId}::uuid`;
      await database.onModuleDestroy();
    }
  },
);

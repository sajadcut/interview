import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import type { DatabaseService } from "../database/database.service";
import type { TenantContextService } from "../tenant/tenant-context.service";
import { InterviewSessionStateService } from "./interview-session-state.service";

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

async function seedInterviewSession(database: DatabaseService) {
  const organizationId = randomUUID();
  const jobId = randomUUID();
  const rubricId = randomUUID();
  const rubricVersionId = randomUUID();
  const releaseUnitId = randomUUID();
  const planId = randomUUID();
  const candidateId = randomUUID();
  const applicationId = randomUUID();
  const sessionId = randomUUID();

  await database.sql`
    INSERT INTO organizations (id, name, slug)
    VALUES (${organizationId}::uuid, 'State Machine Integration', ${`state-machine-${organizationId}`})
  `;
  await database.sql`
    INSERT INTO jobs (id, organization_id, title, status)
    VALUES (${jobId}::uuid, ${organizationId}::uuid, 'State Machine Role', 'active')
  `;
  await database.sql`
    INSERT INTO rubrics (id, organization_id, job_id, name, status)
    VALUES (${rubricId}::uuid, ${organizationId}::uuid, ${jobId}::uuid, 'State Machine Rubric', 'published')
  `;
  await database.sql`
    INSERT INTO rubric_versions (id, organization_id, rubric_id, version, status, published_at)
    VALUES (${rubricVersionId}::uuid, ${organizationId}::uuid, ${rubricId}::uuid, 1, 'published', now())
  `;
  await database.sql`
    INSERT INTO interview_release_units (
      id, organization_id, job_family, language, interview_type, rubric_version_family,
      interviewer_policy_version, speech_avatar_stack_version, evaluator_version, lifecycle_stage
    ) VALUES (
      ${releaseUnitId}::uuid, ${organizationId}::uuid, 'state-machine', 'en', 'structured', 'state-machine-rubric',
      'policy-v1', 'speech-v1', 'evaluator-v1', 'INTERNAL_TEST'
    )
  `;
  await database.sql`
    INSERT INTO interview_plans (
      id, organization_id, job_id, rubric_version_id, release_unit_id, version, status,
      language, interview_type, time_budget_minutes, recovery_policy
    ) VALUES (
      ${planId}::uuid, ${organizationId}::uuid, ${jobId}::uuid, ${rubricVersionId}::uuid,
      ${releaseUnitId}::uuid, 1, 'published', 'en', 'structured', 30,
      ${database.sql.json({ maxReconnects: 3, maxRecoveryAttempts: 3 } as never)}
    )
  `;
  await database.sql`
    INSERT INTO candidates (id, organization_id, display_name, primary_email)
    VALUES (${candidateId}::uuid, ${organizationId}::uuid, 'State Candidate', 'state@example.invalid')
  `;
  await database.sql`
    INSERT INTO applications (id, organization_id, job_id, candidate_id, status, pipeline_stage)
    VALUES (
      ${applicationId}::uuid, ${organizationId}::uuid, ${jobId}::uuid, ${candidateId}::uuid,
      'active', 'interview'
    )
  `;
  await database.sql`
    INSERT INTO interview_sessions (
      id, organization_id, application_id, interview_plan_id, status, remaining_seconds
    ) VALUES (
      ${sessionId}::uuid, ${organizationId}::uuid, ${applicationId}::uuid,
      ${planId}::uuid, 'invited', 1800
    )
  `;

  return { organizationId, sessionId };
}

test(
  "canonical interview state transitions are persisted, versioned, idempotent and terminal",
  { skip: !integrationDatabaseUrl },
  async () => {
    const database = createIntegrationDatabase();
    const seeded = await seedInterviewSession(database);
    const service = new InterviewSessionStateService(database, tenantContext(seeded.organizationId));

    try {
      const start = await service.transition(seeded.sessionId, {
        idempotencyKey: `start:${seeded.sessionId}`,
        action: "start",
        expectedVersion: 0,
      });
      assert.equal(start.status, "in_progress");
      assert.equal(start.stateVersion, 1);
      assert.ok(start.startedAt);

      const pause = await service.transition(seeded.sessionId, {
        idempotencyKey: `pause:${seeded.sessionId}`,
        action: "pause",
        expectedVersion: 1,
      });
      assert.equal(pause.status, "paused");
      assert.ok(pause.pausedAt);

      const disconnect = await service.transition(seeded.sessionId, {
        idempotencyKey: `disconnect:${seeded.sessionId}`,
        action: "disconnect",
        expectedVersion: 2,
      });
      assert.equal(disconnect.status, "disconnected");
      assert.equal(disconnect.resumeStatus, "paused");

      const reconnect = await service.transition(seeded.sessionId, {
        idempotencyKey: `reconnect:${seeded.sessionId}`,
        action: "reconnect",
        expectedVersion: 3,
      });
      assert.equal(reconnect.status, "paused");
      assert.equal(reconnect.reconnectCount, 1);

      const resume = await service.transition(seeded.sessionId, {
        idempotencyKey: `resume:${seeded.sessionId}`,
        action: "resume",
        expectedVersion: 4,
      });
      assert.equal(resume.status, "in_progress");

      const recoverableFailure = await service.transition(seeded.sessionId, {
        idempotencyKey: `fail:${seeded.sessionId}:1`,
        action: "fail",
        expectedVersion: 5,
        failureCode: "transport_timeout",
        recoverable: true,
      });
      assert.equal(recoverableFailure.status, "disconnected");
      assert.equal(recoverableFailure.failure?.code, "transport_timeout");
      assert.equal(recoverableFailure.recoveryAttemptCount, 1);

      const recovered = await service.transition(seeded.sessionId, {
        idempotencyKey: `recover:${seeded.sessionId}`,
        action: "recover",
        expectedVersion: 6,
      });
      assert.equal(recovered.status, "in_progress");
      assert.equal(recovered.reconnectCount, 2);
      assert.equal(recovered.failure, null);

      const finishInput = {
        idempotencyKey: `finish:${seeded.sessionId}`,
        action: "finish" as const,
        expectedVersion: 7,
      };
      const finish = await service.transition(seeded.sessionId, finishInput);
      assert.equal(finish.status, "completed");
      assert.equal(finish.stateVersion, 8);
      assert.ok(finish.completedAt);
      assert.equal(finish.terminal, true);

      const replay = await service.transition(seeded.sessionId, finishInput);
      assert.equal(replay.status, "completed");
      assert.equal(replay.stateVersion, 8);
      assert.equal(replay.transition.idempotentReplay, true);

      await assert.rejects(
        () => service.transition(seeded.sessionId, {
          idempotencyKey: `resume-after-finish:${seeded.sessionId}`,
          action: "resume",
          expectedVersion: 8,
        }),
        /terminal/,
      );

      const events = await database.sql`
        SELECT sequence, state_version, action, from_status, to_status
        FROM interview_session_state_events
        WHERE organization_id = ${seeded.organizationId}::uuid
          AND interview_session_id = ${seeded.sessionId}::uuid
        ORDER BY sequence
      `;
      assert.equal(events.length, 8);
      assert.deepEqual(events.map((row) => Number(row.sequence)), [0, 1, 2, 3, 4, 5, 6, 7]);
      assert.deepEqual(events.map((row) => Number(row.state_version)), [1, 2, 3, 4, 5, 6, 7, 8]);
    } finally {
      await database.sql`DELETE FROM organizations WHERE id = ${seeded.organizationId}::uuid`;
      await database.onModuleDestroy();
    }
  },
);

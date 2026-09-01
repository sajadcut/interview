import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import type { DatabaseService } from "../database/database.service";
import type { TenantContextService } from "../tenant/tenant-context.service";
import { InterviewMediaEventService } from "./interview-media-event.service";

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
  return {
    require: () => ({ organizationId }),
  } as TenantContextService;
}

async function seedMediaSession(database: DatabaseService) {
  const organizationId = randomUUID();
  const jobId = randomUUID();
  const rubricId = randomUUID();
  const rubricVersionId = randomUUID();
  const releaseUnitId = randomUUID();
  const planId = randomUUID();
  const candidateId = randomUUID();
  const applicationId = randomUUID();
  const interviewSessionId = randomUUID();
  const mediaSessionId = randomUUID();

  await database.sql`
    INSERT INTO organizations (id, name, slug)
    VALUES (${organizationId}::uuid, 'Media Journal Integration', ${`media-journal-${organizationId}`})
  `;
  await database.sql`
    INSERT INTO jobs (id, organization_id, title, status)
    VALUES (${jobId}::uuid, ${organizationId}::uuid, 'Integration Role', 'active')
  `;
  await database.sql`
    INSERT INTO rubrics (id, organization_id, job_id, name, status)
    VALUES (${rubricId}::uuid, ${organizationId}::uuid, ${jobId}::uuid, 'Integration Rubric', 'published')
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
      ${releaseUnitId}::uuid, ${organizationId}::uuid, 'integration', 'en', 'structured', 'integration-rubric',
      'policy-v1', 'speech-v1', 'evaluator-v1', 'INTERNAL_TEST'
    )
  `;
  await database.sql`
    INSERT INTO interview_plans (
      id, organization_id, job_id, rubric_version_id, release_unit_id, version, status,
      language, interview_type, time_budget_minutes
    ) VALUES (
      ${planId}::uuid, ${organizationId}::uuid, ${jobId}::uuid, ${rubricVersionId}::uuid,
      ${releaseUnitId}::uuid, 1, 'published', 'en', 'structured', 30
    )
  `;
  await database.sql`
    INSERT INTO candidates (id, organization_id, display_name, primary_email)
    VALUES (${candidateId}::uuid, ${organizationId}::uuid, 'Media Candidate', 'media@example.invalid')
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
      ${interviewSessionId}::uuid, ${organizationId}::uuid, ${applicationId}::uuid,
      ${planId}::uuid, 'in_progress', 1800
    )
  `;
  await database.sql`
    INSERT INTO interview_media_sessions (
      id, organization_id, interview_session_id, mode, status, transport_provider
    ) VALUES (
      ${mediaSessionId}::uuid, ${organizationId}::uuid, ${interviewSessionId}::uuid,
      'audio', 'connected', 'contract-test'
    )
  `;

  return { organizationId, interviewSessionId, mediaSessionId };
}

test(
  "media event journal is idempotent and persists participant/TURN lifecycle",
  { skip: !integrationDatabaseUrl },
  async () => {
    const database = createIntegrationDatabase();
    const seeded = await seedMediaSession(database);
    const service = new InterviewMediaEventService(database, tenantContext(seeded.organizationId));

    try {
      const connectedInput = {
        idempotencyKey: `connected:${seeded.mediaSessionId}`,
        eventType: "connected" as const,
        sourceComponent: "transport" as const,
        payload: { transport: "contract-test" },
      };
      const first = await service.appendEvent(
        seeded.interviewSessionId,
        seeded.mediaSessionId,
        connectedInput,
      );
      const replay = await service.appendEvent(
        seeded.interviewSessionId,
        seeded.mediaSessionId,
        connectedInput,
      );
      assert.equal(first.idempotentReplay, false);
      assert.equal(replay.idempotentReplay, true);
      assert.equal(replay.id, first.id);
      assert.equal(replay.sequence, first.sequence);

      const duplicateRows = await database.sql`
        SELECT count(*)::int AS count
        FROM interview_media_events
        WHERE organization_id = ${seeded.organizationId}::uuid
          AND media_session_id = ${seeded.mediaSessionId}::uuid
          AND idempotency_key = ${connectedInput.idempotencyKey}
      `;
      assert.equal(Number(duplicateRows[0]?.count), 1);

      await service.appendEvent(seeded.interviewSessionId, seeded.mediaSessionId, {
        idempotencyKey: `candidate:${seeded.mediaSessionId}:joined`,
        eventType: "participant_joined",
        sourceComponent: "transport",
        payload: { participantKey: "candidate-primary", participantType: "candidate" },
      });
      let participants = await service.listParticipants(
        seeded.interviewSessionId,
        seeded.mediaSessionId,
      );
      assert.equal(participants.length, 1);
      assert.equal(participants[0]?.state, "joined");

      await service.appendEvent(seeded.interviewSessionId, seeded.mediaSessionId, {
        idempotencyKey: `candidate:${seeded.mediaSessionId}:left`,
        eventType: "participant_left",
        sourceComponent: "transport",
        payload: { participantKey: "candidate-primary", participantType: "candidate" },
      });
      participants = await service.listParticipants(seeded.interviewSessionId, seeded.mediaSessionId);
      assert.equal(participants[0]?.state, "left");
      assert.ok(participants[0]?.leftAt);

      const failure = await service.appendEvent(seeded.interviewSessionId, seeded.mediaSessionId, {
        idempotencyKey: `turn:${seeded.mediaSessionId}:failure`,
        eventType: "turn_failure",
        sourceComponent: "transport",
        payload: { failureCode: "relay_unreachable" },
      });
      assert.equal(failure.status, "degraded");

      const mediaRows = await database.sql`
        SELECT status, last_error
        FROM interview_media_sessions
        WHERE organization_id = ${seeded.organizationId}::uuid
          AND id = ${seeded.mediaSessionId}::uuid
      `;
      assert.equal(String(mediaRows[0]?.status), "degraded");
      assert.match(String(mediaRows[0]?.last_error), /TURN failure: relay_unreachable/);
    } finally {
      await database.sql`DELETE FROM organizations WHERE id = ${seeded.organizationId}::uuid`;
      await database.onModuleDestroy();
    }
  },
);

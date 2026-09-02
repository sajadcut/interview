import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import type { DatabaseService } from "../database/database.service";
import type { TenantContextService } from "../tenant/tenant-context.service";
import { INTERVIEW_EVALUATOR_DRAFT_SCHEMA } from "./interview-evaluator";
import { InterviewEvaluatorService } from "./interview-evaluator.service";

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

async function seedEvaluator(database: DatabaseService) {
  const organizationId = randomUUID();
  const jobId = randomUUID();
  const rubricId = randomUUID();
  const rubricVersionId = randomUUID();
  const criterionA = randomUUID();
  const criterionB = randomUUID();
  const releaseUnitId = randomUUID();
  const planId = randomUUID();
  const candidateId = randomUUID();
  const applicationId = randomUUID();
  const sessionId = randomUUID();
  const segmentA = randomUUID();
  const segmentB = randomUUID();
  const evidenceA = randomUUID();
  const evidenceB = randomUUID();

  await database.sql`
    INSERT INTO organizations (id, name, slug)
    VALUES (${organizationId}::uuid, 'Evaluator Integration', ${`evaluator-${organizationId}`})
  `;
  await database.sql`
    INSERT INTO jobs (id, organization_id, title, status)
    VALUES (${jobId}::uuid, ${organizationId}::uuid, 'Evaluator Role', 'active')
  `;
  await database.sql`
    INSERT INTO rubrics (id, organization_id, job_id, name, status)
    VALUES (${rubricId}::uuid, ${organizationId}::uuid, ${jobId}::uuid, 'Evaluator Rubric', 'published')
  `;
  await database.sql`
    INSERT INTO rubric_versions (id, organization_id, rubric_id, version, status, published_at)
    VALUES (${rubricVersionId}::uuid, ${organizationId}::uuid, ${rubricId}::uuid, 1, 'published', now())
  `;
  await database.sql`
    INSERT INTO rubric_criteria (
      id, organization_id, rubric_version_id, criterion_key, label, weight, required, display_order
    ) VALUES
      (${criterionA}::uuid, ${organizationId}::uuid, ${rubricVersionId}::uuid, 'architecture', 'Architecture', 2, true, 0),
      (${criterionB}::uuid, ${organizationId}::uuid, ${rubricVersionId}::uuid, 'debugging', 'Debugging', 1, true, 1)
  `;
  await database.sql`
    INSERT INTO interview_release_units (
      id, organization_id, job_family, language, interview_type, rubric_version_family,
      interviewer_policy_version, speech_avatar_stack_version, evaluator_version, lifecycle_stage
    ) VALUES (
      ${releaseUnitId}::uuid, ${organizationId}::uuid, 'integration', 'en', 'structured', 'rubric-v1',
      'policy-v1', 'speech-v1', 'evidence-evaluator-v1', 'INTERNAL_TEST'
    )
  `;
  await database.sql`
    INSERT INTO interview_plans (
      id, organization_id, job_id, rubric_version_id, release_unit_id,
      version, status, language, interview_type, time_budget_minutes
    ) VALUES (
      ${planId}::uuid, ${organizationId}::uuid, ${jobId}::uuid, ${rubricVersionId}::uuid,
      ${releaseUnitId}::uuid, 1, 'published', 'en', 'structured', 30
    )
  `;
  await database.sql`
    INSERT INTO candidates (id, organization_id, display_name, primary_email)
    VALUES (${candidateId}::uuid, ${organizationId}::uuid, 'Evaluator Candidate', 'evaluator@example.invalid')
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
      id, organization_id, application_id, interview_plan_id, status, remaining_seconds, completed_at
    ) VALUES (
      ${sessionId}::uuid, ${organizationId}::uuid, ${applicationId}::uuid,
      ${planId}::uuid, 'completed', 0, now()
    )
  `;
  await database.sql`
    INSERT INTO interview_transcript_segments (
      id, organization_id, interview_session_id, speaker, start_ms, end_ms, text, is_final, stt_confidence
    ) VALUES
      (${segmentA}::uuid, ${organizationId}::uuid, ${sessionId}::uuid, 'candidate', 0, 1000, 'Architecture example', true, 0.95),
      (${segmentB}::uuid, ${organizationId}::uuid, ${sessionId}::uuid, 'candidate', 1100, 2000, 'Debugging example', true, 0.85)
  `;
  await database.sql`
    INSERT INTO interview_evidence (
      id, organization_id, interview_session_id, criterion_id,
      transcript_segment_ids, summary, confidence
    ) VALUES
      (${evidenceA}::uuid, ${organizationId}::uuid, ${sessionId}::uuid, ${criterionA}::uuid,
       ${[segmentA]}::uuid[], 'Architecture evidence', 0.90),
      (${evidenceB}::uuid, ${organizationId}::uuid, ${sessionId}::uuid, ${criterionB}::uuid,
       ${[segmentB]}::uuid[], 'Debugging evidence', 0.80)
  `;

  return {
    organizationId,
    sessionId,
    criterionA,
    criterionB,
    evidenceA,
    evidenceB,
  };
}

test(
  "evaluator persists evidence-backed criteria, deterministic scorecard and idempotent replay",
  { skip: !integrationDatabaseUrl },
  async () => {
    const database = createIntegrationDatabase();
    const seeded = await seedEvaluator(database);
    const service = new InterviewEvaluatorService(database, tenantContext(seeded.organizationId));
    const request = {
      schemaVersion: INTERVIEW_EVALUATOR_DRAFT_SCHEMA,
      idempotencyKey: `evaluation:${seeded.sessionId}:v1`,
      evaluatorVersion: "evidence-evaluator-v1",
      criterionResults: [
        {
          criterionId: seeded.criterionA,
          score: 90,
          rationale: "Concrete architecture evidence was present.",
          evidenceIds: [seeded.evidenceA],
          confidence: 0.92,
        },
        {
          criterionId: seeded.criterionB,
          score: 60,
          rationale: "Concrete debugging evidence was present.",
          evidenceIds: [seeded.evidenceB],
          confidence: 0.90,
        },
      ],
      providerRecommendation: "strong_recommend",
      provenance: {
        provider: "integration-fixture",
        model: "fixture-v1",
        promptVersion: "evaluator-prompt-v1",
        traceReference: `trace:${seeded.sessionId}`,
      },
    };

    try {
      const first = await service.evaluateAndPersist(seeded.sessionId, request);
      assert.equal(first.idempotentReplay, false);
      assert.equal(first.output.overallScore, 80);
      assert.equal(first.output.recommendation, "review");
      assert.equal(first.output.evidenceComplete, true);
      assert.ok(first.scorecardId);

      const replay = await service.evaluateAndPersist(seeded.sessionId, request);
      assert.equal(replay.idempotentReplay, true);
      assert.equal(replay.evaluationId, first.evaluationId);
      assert.equal(replay.scorecardId, first.scorecardId);
      assert.deepEqual(replay.output, first.output);

      const evaluationRows = await database.sql`
        SELECT status, provider, model, prompt_version, overall_confidence,
               weighted_score, score_algorithm_version, requires_human_review,
               evidence_complete, scorecard_id, output_snapshot
        FROM interview_evaluations
        WHERE organization_id = ${seeded.organizationId}::uuid
          AND interview_session_id = ${seeded.sessionId}::uuid
      `;
      assert.equal(evaluationRows.length, 1);
      assert.equal(String(evaluationRows[0]?.status), "validated");
      assert.equal(String(evaluationRows[0]?.provider), "integration-fixture");
      assert.equal(Number(evaluationRows[0]?.weighted_score), 80);
      assert.equal(String(evaluationRows[0]?.score_algorithm_version), "weighted-evidence-v1");
      assert.equal(Boolean(evaluationRows[0]?.requires_human_review), true);
      assert.equal(Boolean(evaluationRows[0]?.evidence_complete), true);
      assert.ok(evaluationRows[0]?.scorecard_id);

      const criterionRows = await database.sql`
        SELECT count(*)::int AS count
        FROM candidate_criterion_evaluations
        WHERE organization_id = ${seeded.organizationId}::uuid
          AND evaluator_type = 'ai'
          AND evaluator_version = 'evidence-evaluator-v1'
      `;
      assert.equal(Number(criterionRows[0]?.count), 2);

      const scorecardRows = await database.sql`
        SELECT count(*)::int AS count
        FROM scorecards
        WHERE organization_id = ${seeded.organizationId}::uuid
      `;
      assert.equal(Number(scorecardRows[0]?.count), 1);
    } finally {
      await database.sql`DELETE FROM organizations WHERE id = ${seeded.organizationId}::uuid`;
      await database.onModuleDestroy();
    }
  },
);

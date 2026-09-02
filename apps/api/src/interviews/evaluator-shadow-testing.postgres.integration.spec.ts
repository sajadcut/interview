import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import type { AuthContextService } from "../auth/auth-context.service";
import type { DatabaseService } from "../database/database.service";
import type { TenantContextService } from "../tenant/tenant-context.service";
import { INTERVIEW_EVALUATOR_DRAFT_SCHEMA } from "./interview-evaluator";
import { InterviewEvaluatorService } from "./interview-evaluator.service";
import { EvaluatorShadowTestingService } from "./evaluator-shadow-testing.service";

const integrationDatabaseUrl = process.env.AUTH_INTEGRATION_DATABASE_URL;

function createIntegrationDatabase(): DatabaseService {
  if (!integrationDatabaseUrl) throw new Error("AUTH_INTEGRATION_DATABASE_URL is required");
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
  return {
    getOptional: () => ({ userId, source: "session" as const }),
  } as AuthContextService;
}

async function seedShadow(database: DatabaseService) {
  const organizationId = randomUUID();
  const userId = randomUUID();
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
    VALUES (${organizationId}::uuid, 'Shadow Integration', ${`shadow-${organizationId}`})
  `;
  await database.sql`
    INSERT INTO users (id, email, display_name)
    VALUES (${userId}::uuid, ${`shadow-${userId}@example.invalid`}, 'Shadow Reviewer')
  `;
  await database.sql`
    INSERT INTO jobs (id, organization_id, title, status)
    VALUES (${jobId}::uuid, ${organizationId}::uuid, 'Shadow Role', 'active')
  `;
  await database.sql`
    INSERT INTO rubrics (id, organization_id, job_id, name, status)
    VALUES (${rubricId}::uuid, ${organizationId}::uuid, ${jobId}::uuid, 'Shadow Rubric', 'published')
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
      ${releaseUnitId}::uuid, ${organizationId}::uuid, 'backend', 'fa', 'technical-screen', 'rubric-v1',
      'policy-v1', 'speech-v1', 'shadow-evaluator-v1', 'SHADOW'
    )
  `;
  await database.sql`
    INSERT INTO interview_plans (
      id, organization_id, job_id, rubric_version_id, release_unit_id,
      version, status, language, interview_type, time_budget_minutes
    ) VALUES (
      ${planId}::uuid, ${organizationId}::uuid, ${jobId}::uuid, ${rubricVersionId}::uuid,
      ${releaseUnitId}::uuid, 1, 'published', 'fa', 'technical-screen', 30
    )
  `;
  await database.sql`
    INSERT INTO candidates (id, organization_id, display_name, primary_email)
    VALUES (${candidateId}::uuid, ${organizationId}::uuid, 'Shadow Candidate', 'shadow@example.invalid')
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
      (${segmentB}::uuid, ${organizationId}::uuid, ${sessionId}::uuid, 'candidate', 1100, 2000, 'Debugging example', true, 0.90)
  `;
  await database.sql`
    INSERT INTO interview_evidence (
      id, organization_id, interview_session_id, criterion_id, transcript_segment_ids, summary, confidence
    ) VALUES
      (${evidenceA}::uuid, ${organizationId}::uuid, ${sessionId}::uuid, ${criterionA}::uuid,
       ${[segmentA]}::uuid[], 'Architecture evidence', 0.90),
      (${evidenceB}::uuid, ${organizationId}::uuid, ${sessionId}::uuid, ${criterionB}::uuid,
       ${[segmentB]}::uuid[], 'Debugging evidence', 0.85)
  `;

  return {
    organizationId,
    userId,
    releaseUnitId,
    applicationId,
    sessionId,
    criterionA,
    criterionB,
    evidenceA,
    evidenceB,
  };
}

test(
  "shadow framework seals AI output, persists comparison and never writes hiring-decision artifacts",
  { skip: !integrationDatabaseUrl },
  async () => {
    const database = createIntegrationDatabase();
    const seeded = await seedShadow(database);
    const tenant = tenantContext(seeded.organizationId);
    const evaluator = new InterviewEvaluatorService(database, tenant);
    const shadow = new EvaluatorShadowTestingService(
      database,
      tenant,
      authContext(seeded.userId),
      evaluator,
    );

    try {
      const program = await shadow.createProgram({
        releaseUnitId: seeded.releaseUnitId,
        name: "Persian backend shadow v1",
        targetSampleSize: 1,
        thresholds: {
          minimumHumanOutcomeRate: 1,
          minimumRecommendationAgreementRate: 0,
          maximumFalseRejectRate: 1,
          maximumFalsePromotionRate: 1,
          maximumMeanAbsoluteScoreDelta: 100,
          minimumCriterionCoverageRate: 0,
          maximumLowConfidenceRate: 1,
          minimumSpearmanRankingCorrelation: -1,
        },
      });
      assert.equal(program.status, "draft");
      const activated = await shadow.activateProgram(program.id);
      assert.equal(activated.status, "active");

      const draft = {
        schemaVersion: INTERVIEW_EVALUATOR_DRAFT_SCHEMA,
        idempotencyKey: `shadow:${seeded.sessionId}:v1`,
        evaluatorVersion: "shadow-evaluator-v1",
        criterionResults: [
          {
            criterionId: seeded.criterionA,
            score: 90,
            rationale: "Architecture evidence supports the criterion.",
            evidenceIds: [seeded.evidenceA],
            confidence: 0.92,
          },
          {
            criterionId: seeded.criterionB,
            score: 60,
            rationale: "Debugging evidence supports the criterion.",
            evidenceIds: [seeded.evidenceB],
            confidence: 0.90,
          },
        ],
        providerRecommendation: "strong_recommend",
        provenance: {
          provider: "shadow-fixture",
          model: "fixture-v1",
          promptVersion: "shadow-prompt-v1",
          traceReference: `shadow-trace:${seeded.sessionId}`,
        },
      };

      const run = await shadow.recordRun(program.id, { sessionId: seeded.sessionId, draft });
      assert.equal(run.visibilityState, "sealed");
      assert.equal(run.writesHiringDecisionData, false);
      assert.equal(run.decisionInfluenceProhibited, true);

      const sealed = await shadow.getRun(run.runId);
      assert.equal(sealed.visibilityState, "sealed");
      assert.equal(sealed.aiResult, null);
      assert.equal(sealed.humanOutcomeRecorded, false);

      const aiCriterionRows = await database.sql`
        SELECT count(*)::int AS count
        FROM candidate_criterion_evaluations
        WHERE organization_id = ${seeded.organizationId}::uuid AND evaluator_type = 'ai'
      `;
      const scorecardRows = await database.sql`
        SELECT count(*)::int AS count FROM scorecards
        WHERE organization_id = ${seeded.organizationId}::uuid
      `;
      assert.equal(Number(aiCriterionRows[0]?.count), 0);
      assert.equal(Number(scorecardRows[0]?.count), 0);

      const replay = await shadow.recordRun(program.id, { sessionId: seeded.sessionId, draft });
      assert.equal(replay.idempotentReplay, true);
      assert.equal(replay.runId, run.runId);

      const outcome = await shadow.recordHumanOutcome(run.runId, {
        sourceType: "manual_blind_reference",
        recommendation: "strong_recommend",
        overallScore: 82,
        decisionRecordedAt: new Date().toISOString(),
        criterionResults: [
          { criterionKey: "architecture", score: 85, evidenceRefs: [seeded.evidenceA] },
          { criterionKey: "debugging", score: 76, evidenceRefs: [seeded.evidenceB] },
        ],
      });
      assert.equal(outcome.visibilityState, "unblinded_after_human_outcome");
      assert.equal(outcome.comparison.recommendationAgreement, false);
      assert.equal(outcome.comparison.requiresRootCauseReview, true);

      const unblinded = await shadow.getRun(run.runId);
      assert.equal(unblinded.visibilityState, "unblinded_after_human_outcome");
      assert.ok(unblinded.aiResult);
      assert.ok(unblinded.comparison);

      const rootCause = await shadow.recordRootCauseReview(outcome.comparisonId, {
        categories: ["recommendation_threshold"],
        severity: "moderate",
        notes: "Human reference and AI deterministic recommendation used different practical promotion thresholds.",
      });
      assert.equal(rootCause.comparisonId, outcome.comparisonId);

      const summary = await shadow.summary(program.id);
      assert.equal(summary.metrics.totalRuns, 1);
      assert.equal(summary.metrics.humanOutcomeCount, 1);
      assert.equal(summary.metrics.comparisonCount, 1);
      assert.equal(summary.metrics.rootCausePendingCount, 0);
      assert.equal(summary.gate.releaseAuthority, false);
      assert.equal(summary.decisionInfluenceProhibited, true);
      assert.equal(summary.writesHiringDecisionData, false);

      const finalAiCriterionRows = await database.sql`
        SELECT count(*)::int AS count
        FROM candidate_criterion_evaluations
        WHERE organization_id = ${seeded.organizationId}::uuid AND evaluator_type = 'ai'
      `;
      const finalScorecardRows = await database.sql`
        SELECT count(*)::int AS count FROM scorecards
        WHERE organization_id = ${seeded.organizationId}::uuid
      `;
      const applicationRows = await database.sql`
        SELECT status, pipeline_stage FROM applications
        WHERE organization_id = ${seeded.organizationId}::uuid AND id = ${seeded.applicationId}::uuid
      `;
      assert.equal(Number(finalAiCriterionRows[0]?.count), 0);
      assert.equal(Number(finalScorecardRows[0]?.count), 0);
      assert.equal(String(applicationRows[0]?.status), "active");
      assert.equal(String(applicationRows[0]?.pipeline_stage), "interview");
    } finally {
      await database.sql`DELETE FROM organizations WHERE id = ${seeded.organizationId}::uuid`;
      await database.sql`DELETE FROM users WHERE id = ${seeded.userId}::uuid`;
      await database.onModuleDestroy();
    }
  },
);

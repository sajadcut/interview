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
  const runnerUserId = randomUUID();
  const reviewerUserId = randomUUID();
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
  const failureSessionId = randomUUID();
  const backfillSessionId = randomUUID();
  const segmentA = randomUUID();
  const segmentB = randomUUID();
  const evidenceA = randomUUID();
  const evidenceB = randomUUID();

  await database.sql`
    INSERT INTO organizations (id, name, slug)
    VALUES (${organizationId}::uuid, 'Shadow Integration', ${`shadow-${organizationId}`})
  `;
  await database.sql`
    INSERT INTO users (id, email, display_name) VALUES
      (${runnerUserId}::uuid, ${`shadow-runner-${runnerUserId}@example.invalid`}, 'Shadow Runner'),
      (${reviewerUserId}::uuid, ${`shadow-reviewer-${reviewerUserId}@example.invalid`}, 'Shadow Reviewer')
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
    ) VALUES
      (${sessionId}::uuid, ${organizationId}::uuid, ${applicationId}::uuid, ${planId}::uuid, 'completed', 0, now()),
      (${failureSessionId}::uuid, ${organizationId}::uuid, ${applicationId}::uuid, ${planId}::uuid, 'completed', 0, now()),
      (${backfillSessionId}::uuid, ${organizationId}::uuid, ${applicationId}::uuid, ${planId}::uuid, 'completed', 0, now() - interval '1 day')
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
    runnerUserId,
    reviewerUserId,
    releaseUnitId,
    applicationId,
    sessionId,
    failureSessionId,
    backfillSessionId,
    criterionA,
    criterionB,
    evidenceA,
    evidenceB,
  };
}

test(
  "shadow v2 is prospective, blind, independent, failure-aware and isolated from hiring decisions",
  { skip: !integrationDatabaseUrl },
  async () => {
    const database = createIntegrationDatabase();
    const seeded = await seedShadow(database);
    const tenant = tenantContext(seeded.organizationId);
    const evaluator = new InterviewEvaluatorService(database, tenant);
    const runner = new EvaluatorShadowTestingService(
      database,
      tenant,
      authContext(seeded.runnerUserId),
      evaluator,
    );
    const reviewer = new EvaluatorShadowTestingService(
      database,
      tenant,
      authContext(seeded.reviewerUserId),
      evaluator,
    );

    try {
      const program = await runner.createProgram({
        releaseUnitId: seeded.releaseUnitId,
        name: "Persian backend shadow v2",
        targetSampleSize: 2,
        thresholds: {
minimumHumanOutcomeRate: 1,
minimumRecommendationAgreementRate: 0,
maximumFalseRejectRate: 1,
maximumFalsePromotionRate: 1,
maximumMeanAbsoluteScoreDelta: 100,
minimumCriterionCoverageRate: 1,
maximumLowConfidenceRate: 1,
minimumSpearmanRankingCorrelation: -1,
maximumEvaluatorFailureRate: 1,
minimumEvidenceAgreementRate: 0,
minimumEvidenceAgreementCoverageRate: 0,
        },
      });
      assert.equal(program.status, "draft");
      const activated = await runner.activateProgram(program.id);
      assert.equal(activated.status, "active");
      await database.sql`
        UPDATE interview_sessions
        SET completed_at = now()
        WHERE organization_id = ${seeded.organizationId}::uuid
AND id IN (${seeded.sessionId}::uuid, ${seeded.failureSessionId}::uuid)
      `;

      await assert.rejects(
        () => runner.recordFailure(program.id, {
sessionId: seeded.backfillSessionId,
idempotencyKey: `shadow-failure:${seeded.backfillSessionId}`,
provider: "shadow-fixture",
promptVersion: "shadow-prompt-v2",
failureCategory: "timeout",
        }),
        /prospective-only/,
      );

      const draft = {
        schemaVersion: INTERVIEW_EVALUATOR_DRAFT_SCHEMA,
        idempotencyKey: `shadow:${seeded.sessionId}:v2`,
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
model: "fixture-v2",
promptVersion: "shadow-prompt-v2",
traceReference: `shadow-trace:${seeded.sessionId}`,
        },
      };

      const run = await runner.recordRun(program.id, {
        sessionId: seeded.sessionId,
        draft,
        latencyMs: 321,
        retryCount: 1,
      });
      assert.equal(run.visibilityState, "sealed");
      assert.equal(run.executionStatus, "succeeded");
      assert.equal(run.writesHiringDecisionData, false);

      const persistedRuns = await database.sql`
        SELECT execution_status, input_snapshot, session_completed_at,
     evaluator_latency_ms, retry_count, input_fingerprint, draft_fingerprint
        FROM evaluator_shadow_runs
        WHERE organization_id = ${seeded.organizationId}::uuid AND id = ${run.runId}::uuid
      `;
      assert.equal(String(persistedRuns[0]?.execution_status), "succeeded");
      assert.ok(persistedRuns[0]?.input_snapshot);
      assert.ok(persistedRuns[0]?.session_completed_at);
      assert.equal(Number(persistedRuns[0]?.evaluator_latency_ms), 321);
      assert.equal(Number(persistedRuns[0]?.retry_count), 1);
      assert.equal(String(persistedRuns[0]?.input_fingerprint).length, 64);
      assert.equal(String(persistedRuns[0]?.draft_fingerprint).length, 64);

      const sealed = await runner.getRun(run.runId);
      assert.equal(sealed.visibilityState, "sealed");
      assert.equal(sealed.aiResult, null);
      assert.equal(sealed.humanOutcomeRecorded, false);

      const replay = await runner.recordRun(program.id, { sessionId: seeded.sessionId, draft, latencyMs: 321, retryCount: 1 });
      assert.equal(replay.idempotentReplay, true);
      assert.equal(replay.runId, run.runId);

      await assert.rejects(
        () => runner.recordRun(program.id, {
sessionId: seeded.sessionId,
draft: { ...draft, idempotencyKey: `shadow:${seeded.sessionId}:different` },
        }),
        /already has a sealed shadow sample/,
      );

      const humanBody = {
        sourceType: "manual_blind_reference",
        blindReviewConfirmed: true,
        recommendation: "strong_recommend",
        overallScore: 82,
        decisionRecordedAt: new Date().toISOString(),
        criterionResults: [
{ criterionKey: "architecture", score: 85, evidenceRefs: [seeded.evidenceA] },
{ criterionKey: "debugging", score: 76, evidenceRefs: [seeded.evidenceB] },
        ],
      };
      await assert.rejects(
        () => runner.recordHumanOutcome(run.runId, humanBody),
        /must be independent/,
      );
      await assert.rejects(
        () => reviewer.recordHumanOutcome(run.runId, { ...humanBody, blindReviewConfirmed: false }),
        /blindReviewConfirmed must be true/,
      );
      await assert.rejects(
        () => reviewer.recordHumanOutcome(run.runId, {
...humanBody,
criterionResults: [{ criterionKey: "architecture", score: 85, evidenceRefs: [seeded.evidenceA] }],
        }),
        /complete rubric/,
      );

      const outcome = await reviewer.recordHumanOutcome(run.runId, humanBody);
      assert.equal(outcome.visibilityState, "unblinded_after_human_outcome");
      assert.equal(outcome.blindReviewConfirmed, true);
      assert.equal(outcome.reviewerIndependent, true);
      assert.equal(outcome.humanOutcomeFingerprint.length, 64);
      assert.equal(outcome.comparisonFingerprint.length, 64);
      assert.equal(outcome.comparison.meanEvidenceAgreementRate, 1);
      assert.equal(outcome.comparison.evidenceAgreementCoverageRate, 1);

      const unblinded = await reviewer.getRun(run.runId);
      assert.equal(unblinded.visibilityState, "unblinded_after_human_outcome");
      assert.ok(unblinded.aiResult);
      assert.equal(unblinded.humanOutcome?.blindReviewConfirmed, true);
      assert.equal(unblinded.humanOutcome?.reviewerIndependent, true);

      const rootCause = await reviewer.recordRootCauseReview(outcome.comparisonId, {
        categories: ["recommendation_threshold"],
        severity: "moderate",
        notes: "Human reference and AI deterministic recommendation used different practical promotion thresholds.",
      });
      assert.equal(rootCause.comparisonId, outcome.comparisonId);

      const failure = await runner.recordFailure(program.id, {
        sessionId: seeded.failureSessionId,
        idempotencyKey: `shadow-failure:${seeded.failureSessionId}:v2`,
        provider: "shadow-fixture",
        model: "fixture-v2",
        promptVersion: "shadow-prompt-v2",
        traceReference: `shadow-failure-trace:${seeded.failureSessionId}`,
        failureCategory: "provider_error",
        failureDetail: { code: "fixture_provider_unavailable" },
        latencyMs: 500,
        retryCount: 2,
      });
      assert.equal(failure.executionStatus, "failed");
      assert.equal(failure.visibilityState, "failed_no_ai_result");
      const failedRun = await reviewer.getRun(failure.runId);
      assert.equal(failedRun.visibilityState, "failed_no_ai_result");
      assert.equal(failedRun.aiResult, null);
      assert.equal(failedRun.execution?.failureCategory, "provider_error");
      await assert.rejects(
        () => reviewer.recordHumanOutcome(failure.runId, humanBody),
        /failed shadow run has no AI result/,
      );

      const summary = await runner.summary(program.id);
      assert.equal(summary.metrics.totalRuns, 2);
      assert.equal(summary.metrics.totalSamples, 2);
      assert.equal(summary.metrics.successfulRuns, 1);
      assert.equal(summary.metrics.failedRuns, 1);
      assert.equal(summary.metrics.evaluatorFailureRate, 0.5);
      assert.equal(summary.metrics.failureCategoryCounts.provider_error, 1);
      assert.equal(summary.metrics.humanOutcomeCount, 1);
      assert.equal(summary.metrics.comparisonCount, 1);
      assert.equal(summary.metrics.meanEvidenceAgreementRate, 1);
      assert.equal(summary.metrics.meanEvidenceAgreementCoverageRate, 1);
      assert.equal(summary.metrics.evaluatorLatencyMs.sampleCount, 2);
      assert.equal(summary.metrics.evaluatorLatencyMs.p95, 500);
      assert.equal(summary.metrics.rootCausePendingCount, 0);
      assert.equal(summary.gate.releaseAuthority, false);
      assert.equal(summary.prospectiveOnly, true);
      assert.equal(summary.oneSamplePerInterviewSession, true);
      assert.equal(summary.decisionInfluenceProhibited, true);
      assert.equal(summary.writesHiringDecisionData, false);

      const aiCriterionRows = await database.sql`
        SELECT count(*)::int AS count
        FROM candidate_criterion_evaluations
        WHERE organization_id = ${seeded.organizationId}::uuid AND evaluator_type = 'ai'
      `;
      const scorecardRows = await database.sql`
        SELECT count(*)::int AS count FROM scorecards
        WHERE organization_id = ${seeded.organizationId}::uuid
      `;
      const applicationRows = await database.sql`
        SELECT status, pipeline_stage FROM applications
        WHERE organization_id = ${seeded.organizationId}::uuid AND id = ${seeded.applicationId}::uuid
      `;
      assert.equal(Number(aiCriterionRows[0]?.count), 0);
      assert.equal(Number(scorecardRows[0]?.count), 0);
      assert.equal(String(applicationRows[0]?.status), "active");
      assert.equal(String(applicationRows[0]?.pipeline_stage), "interview");
    } finally {
      await database.sql`DELETE FROM organizations WHERE id = ${seeded.organizationId}::uuid`;
      await database.sql`DELETE FROM users WHERE id IN (${seeded.runnerUserId}::uuid, ${seeded.reviewerUserId}::uuid)`;
      await database.onModuleDestroy();
    }
  },
);

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import type { AuthContextService } from "../auth/auth-context.service";
import type { DatabaseService } from "../database/database.service";
import type { TenantContextService } from "../tenant/tenant-context.service";
import { EvaluatorCalibrationService } from "./evaluator-calibration.service";

const integrationDatabaseUrl = process.env.AUTH_INTEGRATION_DATABASE_URL;

function createIntegrationDatabase(): DatabaseService {
  if (!integrationDatabaseUrl) {
    throw new Error("AUTH_INTEGRATION_DATABASE_URL is required for PostgreSQL integration tests");
  }
  const sql = postgres(integrationDatabaseUrl, { max: 2, idle_timeout: 20, connect_timeout: 10 });
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
  return { getOptional: () => ({ userId }) } as AuthContextService;
}

async function seedRubric(database: DatabaseService) {
  const organizationId = randomUUID();
  const userId = randomUUID();
  const jobId = randomUUID();
  const rubricId = randomUUID();
  const rubricVersionId = randomUUID();
  await database.sql`
    INSERT INTO organizations (id, name, slug)
    VALUES (${organizationId}::uuid, 'Calibration Integration', ${`calibration-${organizationId}`})
  `;
  await database.sql`
    INSERT INTO users (id, email, display_name)
    VALUES (${userId}::uuid, ${`calibration-${userId}@example.invalid`}, 'Calibration Reviewer')
  `;
  await database.sql`
    INSERT INTO jobs (id, organization_id, title, status)
    VALUES (${jobId}::uuid, ${organizationId}::uuid, 'Calibration Role', 'active')
  `;
  await database.sql`
    INSERT INTO rubrics (id, organization_id, job_id, name, status)
    VALUES (${rubricId}::uuid, ${organizationId}::uuid, ${jobId}::uuid, 'Calibration Rubric', 'published')
  `;
  await database.sql`
    INSERT INTO rubric_versions (id, organization_id, rubric_id, version, status, published_at)
    VALUES (${rubricVersionId}::uuid, ${organizationId}::uuid, ${rubricId}::uuid, 1, 'published', now())
  `;
  await database.sql`
    INSERT INTO rubric_criteria (
      organization_id, rubric_version_id, criterion_key, label, weight, required, display_order
    ) VALUES
      (${organizationId}::uuid, ${rubricVersionId}::uuid, 'architecture', 'Architecture', 2, true, 0),
      (${organizationId}::uuid, ${rubricVersionId}::uuid, 'debugging', 'Debugging', 1, true, 1)
  `;
  return { organizationId, userId, rubricVersionId };
}

test(
  "calibration framework freezes human reference, records detailed AI comparison and evaluates gate",
  { skip: !integrationDatabaseUrl },
  async () => {
    const database = createIntegrationDatabase();
    const seeded = await seedRubric(database);
    const service = new EvaluatorCalibrationService(
      database,
      tenantContext(seeded.organizationId),
      authContext(seeded.userId),
    );
    try {
      const dataset = await service.createDataset({
        datasetKey: "backend-engineering",
        version: "v1",
        name: "Backend calibration v1",
        thresholds: {
          minimumCaseCount: 1,
          minimumCoverageRate: 1,
          maximumMeanAbsoluteScoreDelta: 10,
          minimumWithinToleranceRate: 1,
          minimumRecommendationAgreementRate: 1,
          maximumFalseRejectRate: 0,
          maximumFalsePromotionRate: 0,
          minimumEvidenceAgreementRate: 0.5,
        },
      });
      const calibrationCase = await service.createCase(dataset.id, {
        caseKey: "case-001",
        rubricVersionId: seeded.rubricVersionId,
        name: "Representative backend interview",
        language: "fa-IR",
        jobFamily: "backend",
        interviewType: "structured_competency",
        tolerance: 10,
        transcriptFixture: [{ speaker: "candidate", text: "fixture" }],
      });
      const humanReview = await service.addHumanReview(calibrationCase.id, {
        criterionResults: [
          { criterionKey: "architecture", score: 80, evidenceRefs: ["segment:a"] },
          { criterionKey: "debugging", score: 70, evidenceRefs: ["segment:b"] },
        ],
        recommendation: "review",
        overallScore: 76.67,
        confidence: 0.95,
        reviewerReference: "qualified-reviewer-fixture",
        setAsReference: true,
      });
      assert.equal(humanReview.isReference, true);
      const locked = await service.lockDataset(dataset.id);
      assert.equal(locked.status, "locked");

      const request = {
        evaluatorVersion: "evidence-evaluator-v1",
        idempotencyKey: `calibration:${calibrationCase.id}:v1`,
        criterionResults: [
          { criterionKey: "architecture", score: 85, confidence: 0.9, evidenceRefs: ["segment:a"] },
          { criterionKey: "debugging", score: 75, confidence: 0.8, evidenceRefs: ["segment:b"] },
        ],
        recommendation: "review",
        provider: "integration-fixture",
        model: "fixture-v1",
        promptVersion: "calibration-prompt-v1",
      };
      const run = await service.recordRun(calibrationCase.id, request);
      assert.equal(run.idempotentReplay, false);
      assert.equal(run.coverageRate, 1);
      assert.equal(run.meanAbsoluteScoreDelta, 5);
      assert.equal(run.recommendationAgreement, true);
      assert.equal(run.evidenceAgreementRate, 1);
      assert.equal(run.falseReject, false);
      assert.equal(run.falsePromotion, false);
      assert.equal(run.casePass, true);

      const replay = await service.recordRun(calibrationCase.id, request);
      assert.equal(replay.idempotentReplay, true);
      assert.equal(replay.id, run.id);

      await assert.rejects(
        () => service.recordRun(calibrationCase.id, {
          ...request,
          criterionResults: [
            { criterionKey: "architecture", score: 20 },
            { criterionKey: "debugging", score: 20 },
          ],
        }),
        /idempotency key was already used with different input/,
      );

      const summary = await service.summary(dataset.id, "evidence-evaluator-v1");
      assert.equal(summary.runCount, 1);
      assert.equal(summary.coverageRate, 1);
      assert.equal(summary.meanAbsoluteScoreDelta, 5);
      assert.equal(summary.falseRejectRate, 0);
      assert.equal(summary.slices.length, 1);
      assert.equal(summary.slices[0]?.language, "fa-IR");

      const gate = await service.gate(dataset.id, "evidence-evaluator-v1");
      assert.equal(gate.status, "passed");
      assert.equal(gate.releaseAuthority, "none");

      await assert.rejects(
        () => service.addHumanReview(calibrationCase.id, {
          criterionResults: [
            { criterionKey: "architecture", score: 90 },
            { criterionKey: "debugging", score: 90 },
          ],
          setAsReference: true,
        }),
        /immutable after the calibration dataset is locked/,
      );
    } finally {
      await database.sql`DELETE FROM organizations WHERE id = ${seeded.organizationId}::uuid`;
      await database.sql`DELETE FROM users WHERE id = ${seeded.userId}::uuid`;
      await database.onModuleDestroy();
    }
  },
);

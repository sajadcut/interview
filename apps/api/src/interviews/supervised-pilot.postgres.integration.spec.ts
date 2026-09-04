import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import type { AuthContextService } from "../auth/auth-context.service";
import type { DatabaseService } from "../database/database.service";
import { SupervisedPilotAwareRecruitingOperationsService } from "../recruiting/supervised-pilot-aware-recruiting-operations.service";
import type { TenantContextService } from "../tenant/tenant-context.service";
import { SupervisedPilotAwareInterviewsService } from "./supervised-pilot-aware-interviews.service";
import type { SupervisedPilotRuntimeGateService } from "./supervised-pilot-runtime-gate.service";
import { SupervisedPilotService } from "./supervised-pilot.service";

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
  return { getOptional: () => ({ userId, source: "session" as const }) } as AuthContextService;
}

function runtimeGate(enabled: boolean): SupervisedPilotRuntimeGateService {
  return { isEnabled: () => enabled } as SupervisedPilotRuntimeGateService;
}

function pilotService(
  database: DatabaseService,
  tenant: TenantContextService,
  userId: string,
  enabled = true,
): SupervisedPilotService {
  return new SupervisedPilotService(database, tenant, authContext(userId), runtimeGate(enabled));
}

async function seedPilot(database: DatabaseService) {
  const organizationId = randomUUID();
  const creatorId = randomUUID();
  const reviewerId = randomUUID();
  const incidentOwnerId = randomUUID();
  const customerApproverId = randomUUID();
  const securityApproverId = randomUUID();
  const goLiveApproverId = randomUUID();
  const jobId = randomUUID();
  const rubricId = randomUUID();
  const rubricVersionId = randomUUID();
  const releaseUnitId = randomUUID();
  const planId = randomUUID();
  const candidateId = randomUUID();
  const applicationId = randomUUID();
  const consentRecordId = randomUUID();
  const secondCandidateId = randomUUID();
  const secondApplicationId = randomUUID();
  const secondConsentRecordId = randomUUID();
  const userIds = [
    creatorId,
    reviewerId,
    incidentOwnerId,
    customerApproverId,
    securityApproverId,
    goLiveApproverId,
  ];

  await database.sql`
    INSERT INTO organizations (id, name, slug)
    VALUES (${organizationId}::uuid, 'Pilot Integration', ${`pilot-${organizationId}`})
  `;
  for (const [index, userId] of userIds.entries()) {
    await database.sql`
      INSERT INTO users (id, email, display_name)
      VALUES (${userId}::uuid, ${`pilot-${index}-${userId}@example.invalid`}, ${`Pilot User ${index}`})
    `;
    await database.sql`
      INSERT INTO memberships (organization_id, user_id, status)
      VALUES (${organizationId}::uuid, ${userId}::uuid, 'active')
    `;
  }
  await database.sql`
    INSERT INTO jobs (id, organization_id, title, status)
    VALUES (${jobId}::uuid, ${organizationId}::uuid, 'Pilot Role', 'active')
  `;
  await database.sql`
    INSERT INTO rubrics (id, organization_id, job_id, name, status)
    VALUES (${rubricId}::uuid, ${organizationId}::uuid, ${jobId}::uuid, 'Pilot Rubric', 'published')
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
      ${releaseUnitId}::uuid, ${organizationId}::uuid, 'backend', 'fa', 'technical-screen', 'rubric-v1',
      'policy-v1', 'speech-v1', 'evaluator-v1', 'SUPERVISED_PILOT'
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
    VALUES
      (${candidateId}::uuid, ${organizationId}::uuid, 'Pilot Candidate A', ${`candidate-a-${candidateId}@example.invalid`}),
      (${secondCandidateId}::uuid, ${organizationId}::uuid, 'Pilot Candidate B', ${`candidate-b-${secondCandidateId}@example.invalid`})
  `;
  await database.sql`
    INSERT INTO applications (id, organization_id, job_id, candidate_id, status, pipeline_stage)
    VALUES
      (${applicationId}::uuid, ${organizationId}::uuid, ${jobId}::uuid, ${candidateId}::uuid, 'active', 'interview'),
      (${secondApplicationId}::uuid, ${organizationId}::uuid, ${jobId}::uuid, ${secondCandidateId}::uuid, 'active', 'interview')
  `;
  await database.sql`
    INSERT INTO consent_records (
      id, organization_id, candidate_id, application_id, purpose, policy_version,
      recording_allowed, transcript_allowed, granted_at
    ) VALUES
      (${consentRecordId}::uuid, ${organizationId}::uuid, ${candidateId}::uuid, ${applicationId}::uuid,
       'ai_interview', 'pilot-consent-v1', false, true, now()),
      (${secondConsentRecordId}::uuid, ${organizationId}::uuid, ${secondCandidateId}::uuid, ${secondApplicationId}::uuid,
       'ai_interview', 'pilot-consent-v1', false, true, now())
  `;

  return {
    organizationId,
    creatorId,
    reviewerId,
    incidentOwnerId,
    customerApproverId,
    securityApproverId,
    goLiveApproverId,
    releaseUnitId,
    planId,
    applicationId,
    consentRecordId,
    secondApplicationId,
    secondConsentRecordId,
    userIds,
  };
}

test(
  "supervised pilot requires independent approvals, enforces quotas and blocks hiring actions until human review",
  { skip: !integrationDatabaseUrl },
  async () => {
    const database = createIntegrationDatabase();
    const seeded = await seedPilot(database);
    const tenant = tenantContext(seeded.organizationId);
    const creatorPilot = pilotService(database, tenant, seeded.creatorId);

    try {
      const now = Date.now();
      const program = await creatorPilot.createProgram({
        releaseUnitId: seeded.releaseUnitId,
        name: "Persian backend supervised pilot v1",
        description: "Controlled pilot with mandatory human review.",
        maxTotalInterviews: 2,
        maxConcurrentInterviews: 1,
        maxInterviewsPerCandidate: 1,
        startsAt: new Date(now - 60_000).toISOString(),
        endsAt: new Date(now + 86_400_000).toISOString(),
        defaultReviewOwnerUserId: seeded.reviewerId,
        incidentOwnerUserId: seeded.incidentOwnerId,
        supportContact: "pilot-support@example.invalid",
      });
      assert.equal(program.status, "draft");
      assert.equal(program.featureEnabled, false);
      assert.equal(program.humanReviewRequired, true);
      assert.equal(program.aiFinalDecisionProhibited, true);

      await creatorPilot.setFeature(program.id, { enabled: true });
      const submitted = await creatorPilot.submitForApproval(program.id);
      assert.equal(submitted.status, "pending_approval");
      assert.equal(submitted.requiredApprovals.length, 4);

      await pilotService(database, tenant, seeded.customerApproverId).decideApproval(
        program.id,
        "customer_acknowledgement",
        { rationale: "Customer explicitly acknowledged supervised pilot status.", evidenceReference: "customer-ack:test-1" },
        "approved",
      );
      await pilotService(database, tenant, seeded.reviewerId).decideApproval(
        program.id,
        "pilot_owner",
        { rationale: "Named human review owner accepts responsibility." },
        "approved",
      );
      await assert.rejects(
        creatorPilot.decideApproval(
          program.id,
          "security_baseline",
          { rationale: "Self approval must fail.", evidenceReference: "security:test-self" },
          "approved",
        ),
        /independent approver/,
      );
      await pilotService(database, tenant, seeded.securityApproverId).decideApproval(
        program.id,
        "security_baseline",
        { rationale: "Pilot security baseline is attested.", evidenceReference: "security:test-1" },
        "approved",
      );
      const approved = await pilotService(database, tenant, seeded.goLiveApproverId).decideApproval(
        program.id,
        "go_live",
        { rationale: "Independent go-live approval after prerequisite approvals." },
        "approved",
      );
      assert.equal(approved.programStatus, "approved");

      const activated = await creatorPilot.activate(program.id);
      assert.equal(activated.status, "active");
      const summary = await creatorPilot.summary(program.id);
      assert.equal(summary.readiness.approvalsComplete, true);
      assert.equal(summary.readiness.humanReviewRequired, true);
      assert.equal(summary.readiness.aiFinalDecisionProhibited, true);

      const interviews = new SupervisedPilotAwareInterviewsService(database, tenant, creatorPilot);
      const firstSession = await interviews.createSession({
        applicationId: seeded.applicationId,
        interviewPlanId: seeded.planId,
        consentRecordId: seeded.consentRecordId,
        candidateIsRealCustomerCandidate: true,
        synchronousHumanSupervisorPresent: true,
      });
      assert.equal(firstSession.lifecycleStage, "SUPERVISED_PILOT");
      assert.equal(firstSession.humanReviewRequired, true);
      assert.equal(firstSession.aiFinalDecisionProhibited, true);

      const reviewRows = await database.sql`
        SELECT r.status, r.review_owner_user_id::text, a.status AS admission_status
        FROM supervised_pilot_human_reviews r
        JOIN supervised_pilot_admissions a
          ON a.organization_id = r.organization_id AND a.id = r.admission_id
        WHERE r.organization_id = ${seeded.organizationId}::uuid
          AND r.interview_session_id = ${firstSession.id}::uuid
      `;
      assert.equal(String(reviewRows[0]?.status), "pending");
      assert.equal(String(reviewRows[0]?.review_owner_user_id), seeded.reviewerId);
      assert.equal(String(reviewRows[0]?.admission_status), "admitted");

      await assert.rejects(
        interviews.createSession({
          applicationId: seeded.secondApplicationId,
          interviewPlanId: seeded.planId,
          consentRecordId: seeded.secondConsentRecordId,
          candidateIsRealCustomerCandidate: true,
          synchronousHumanSupervisorPresent: true,
        }),
        /concurrent\/open interview limit/,
      );

      const guardedOperations = new SupervisedPilotAwareRecruitingOperationsService(
        database,
        tenant,
        authContext(seeded.creatorId),
        creatorPilot,
      );
      await assert.rejects(
        guardedOperations.submitHiringDecision(seeded.applicationId, {
          decision: "advance",
          reason: "Must not advance before mandatory pilot review.",
        }),
        /human review must be completed/,
      );
      await assert.rejects(
        guardedOperations.moveApplicationStage(seeded.applicationId, {
          stage: "onsite",
          reason: "Must not bypass pilot human review.",
        }),
        /human review must be completed/,
      );

      await database.sql`
        UPDATE interview_sessions
        SET status = 'completed', completed_at = now(), updated_at = now()
        WHERE organization_id = ${seeded.organizationId}::uuid AND id = ${firstSession.id}::uuid
      `;
      await assert.rejects(
        pilotService(database, tenant, seeded.goLiveApproverId).recordHumanReview(firstSession.id, {
          recommendation: "advance",
          notes: "Wrong reviewer must not be able to complete the review.",
        }),
        /assigned human review owner/,
      );
      const humanReview = await pilotService(database, tenant, seeded.reviewerId).recordHumanReview(firstSession.id, {
        recommendation: "advance",
        notes: "Human reviewer independently reviewed the completed interview evidence.",
      });
      assert.equal(humanReview.status, "completed");
      assert.equal(humanReview.humanDecisionAuthority, true);
      assert.equal(humanReview.aiFinalDecisionProhibited, true);

      const decision = await guardedOperations.submitHiringDecision(seeded.applicationId, {
        decision: "advance",
        reason: "Human pilot review completed before the hiring action.",
      });
      assert.equal(decision.decision, "advance");
      const moved = await guardedOperations.moveApplicationStage(seeded.applicationId, {
        stage: "onsite",
        reason: "Human pilot review is complete.",
      });
      assert.equal(moved.toStage, "onsite");

      const secondSession = await interviews.createSession({
        applicationId: seeded.secondApplicationId,
        interviewPlanId: seeded.planId,
        consentRecordId: seeded.secondConsentRecordId,
        candidateIsRealCustomerCandidate: true,
        synchronousHumanSupervisorPresent: true,
      });
      assert.ok(secondSession.id);
      await assert.rejects(
        interviews.createSession({
          applicationId: seeded.secondApplicationId,
          interviewPlanId: seeded.planId,
          consentRecordId: seeded.secondConsentRecordId,
          candidateIsRealCustomerCandidate: true,
          synchronousHumanSupervisorPresent: true,
        }),
        /(total interview limit|per-candidate interview limit|concurrent\/open interview limit)/,
      );

      const paused = await creatorPilot.setFeature(program.id, { enabled: false });
      assert.equal(paused.status, "paused");
      assert.equal(paused.featureEnabled, false);
      await assert.rejects(
        pilotService(database, tenant, seeded.creatorId, false).activate(program.id),
        /runtime feature flag is disabled/,
      );

      const approvalEvents = await database.sql`
        SELECT count(*)::int AS count
        FROM supervised_pilot_approval_events
        WHERE organization_id = ${seeded.organizationId}::uuid AND program_id = ${program.id}::uuid
      `;
      assert.ok(Number(approvalEvents[0]?.count ?? 0) >= 8);
    } finally {
      await database.sql`DELETE FROM organizations WHERE id = ${seeded.organizationId}::uuid`;
      await database.sql`DELETE FROM users WHERE id = ANY(${seeded.userIds}::uuid[])`;
      await database.onModuleDestroy();
    }
  },
);

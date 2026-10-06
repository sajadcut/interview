// Regression coverage for the requisition-backed human technical interview workflow.
// The same contract is exercised from the Job workspace scheduling UI.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { AuthContextService } from "../auth/auth-context.service";
import type { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import { InterviewOrchestrationService } from "../interviews/interview-orchestration.service";
import { InterviewAssignmentAdminService } from "./interview-assignment-admin.service";

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
  "technical interview scheduling creates session, assignment and pipeline transition atomically",
  { skip: !integrationDatabaseUrl },
  async () => {
    const database = createIntegrationDatabase();
    const tenantContext = new TenantContextService();
    const authContext = new AuthContextService();
    const orchestration = new InterviewOrchestrationService(database, tenantContext, authContext);
    let invitedApplicationId: string | undefined;
    const candidateAuth = {
      createInvitation: async ({ applicationId: invitedId }: { applicationId: string }) => {
        invitedApplicationId = invitedId;
        return {
          invitationId: randomUUID(),
          otpChallengeId: randomUUID(),
          maskedEmail: "pe***@example.invalid",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          deliveryRequired: true,
          candidate: {
            displayName: "Pending Interview Candidate",
            jobTitle: "Senior .NET Developer",
          },
          developmentToken: "dev-token",
          developmentOtp: "123456",
        };
      },
    } as never;
    const service = new InterviewAssignmentAdminService(
      database,
      tenantContext,
      authContext,
      orchestration,
      candidateAuth,
    );

    const organizationId = randomUUID();
    const actorUserId = randomUUID();
    const interviewerUserId = randomUUID();
    const interviewerMembershipId = randomUUID();
    const interviewerRoleId = randomUUID();
    const jobId = randomUUID();
    const rubricId = randomUUID();
    const rubricVersionId = randomUUID();
    const candidateId = randomUUID();
    const applicationId = randomUUID();
    const pendingCandidateId = randomUUID();
    const pendingApplicationId = randomUUID();
    const suffix = randomUUID();

    try {
      await database.sql`
        INSERT INTO organizations (id, name, slug)
        VALUES (
          ${organizationId}::uuid,
          'Technical Interview Scheduling',
          ${`technical-interview-${suffix}`}
        )
      `;
      await database.sql`
        INSERT INTO users (id, email, display_name) VALUES
          (
            ${actorUserId}::uuid,
            ${`scheduler-${suffix}@example.invalid`},
            'HR Scheduler'
          ),
          (
            ${interviewerUserId}::uuid,
            ${`interviewer-${suffix}@example.invalid`},
            'Technical Interviewer'
          )
      `;
      await database.sql`
        INSERT INTO memberships (id, organization_id, user_id, status)
        VALUES (
          ${interviewerMembershipId}::uuid,
          ${organizationId}::uuid,
          ${interviewerUserId}::uuid,
          'active'
        )
      `;
      await database.sql`
        INSERT INTO roles (id, organization_id, key, name)
        VALUES (
          ${interviewerRoleId}::uuid,
          ${organizationId}::uuid,
          'INTERVIEWER',
          'Interviewer'
        )
      `;
      await database.sql`
        INSERT INTO interviewer_profiles (
          organization_id, email, first_name, last_name, job_title, status
        ) VALUES (
          ${organizationId}::uuid,
          ${`interviewer-${suffix}@example.invalid`},
          'Technical',
          'Interviewer',
          'Senior .NET Interviewer',
          'active'
        )
      `;
      await database.sql`
        INSERT INTO membership_roles (organization_id, membership_id, role_id)
        VALUES (
          ${organizationId}::uuid,
          ${interviewerMembershipId}::uuid,
          ${interviewerRoleId}::uuid
        )
      `;
      await database.sql`
        INSERT INTO jobs (id, organization_id, title, status)
        VALUES (
          ${jobId}::uuid,
          ${organizationId}::uuid,
          'Senior .NET Developer',
          'open'
        )
      `;
      await database.sql`
        INSERT INTO rubrics (id, organization_id, job_id, name, status)
        VALUES (
          ${rubricId}::uuid,
          ${organizationId}::uuid,
          ${jobId}::uuid,
          '.NET Technical Rubric',
          'published'
        )
      `;
      await database.sql`
        INSERT INTO rubric_versions (id, organization_id, rubric_id, version, status, published_at)
        VALUES (
          ${rubricVersionId}::uuid,
          ${organizationId}::uuid,
          ${rubricId}::uuid,
          1,
          'published',
          now()
        )
      `;
      await database.sql`
        INSERT INTO rubric_criteria (
          organization_id, rubric_version_id, criterion_key, label, weight, required, display_order
        ) VALUES (
          ${organizationId}::uuid,
          ${rubricVersionId}::uuid,
          'dotnet_depth',
          '.NET technical depth',
          1,
          true,
          0
        )
      `;
      await database.sql`
        INSERT INTO candidates (id, organization_id, display_name, primary_email)
        VALUES
          (
            ${candidateId}::uuid,
            ${organizationId}::uuid,
            'Technical Candidate',
            ${`candidate-${suffix}@example.invalid`}
          ),
          (
            ${pendingCandidateId}::uuid,
            ${organizationId}::uuid,
            'Pending Interview Candidate',
            ${`pending-candidate-${suffix}@example.invalid`}
          )
      `;
      await database.sql`
        INSERT INTO applications (
          id, organization_id, job_id, candidate_id, rubric_version_id, status, pipeline_stage, source
        ) VALUES
          (
            ${applicationId}::uuid,
            ${organizationId}::uuid,
            ${jobId}::uuid,
            ${candidateId}::uuid,
            ${rubricVersionId}::uuid,
            'active',
            'screening',
            'integration-test'
          ),
          (
            ${pendingApplicationId}::uuid,
            ${organizationId}::uuid,
            ${jobId}::uuid,
            ${pendingCandidateId}::uuid,
            ${rubricVersionId}::uuid,
            'active',
            'interview',
            'integration-test'
          )
      `;
      const preparedAi = await tenantContext.run(organizationId, () =>
        authContext.run({ userId: actorUserId, source: "development-header" }, () =>
          service.prepareAiInterview({
            applicationId: pendingApplicationId,
            language: "fa",
          }),
        ),
      );
      assert.equal(preparedAi.applicationId, pendingApplicationId);
      assert.equal(preparedAi.pipelineStage, "interview");
      assert.equal(invitedApplicationId, pendingApplicationId);

      const aiPlans = await database.sql`
        SELECT id::text, status, interview_type, language
        FROM interview_plans
        WHERE organization_id = ${organizationId}::uuid
          AND id = ${preparedAi.interviewPlanId}::uuid
        LIMIT 1
      `;
      assert.equal(String(aiPlans[0]?.status), "published");
      assert.notEqual(String(aiPlans[0]?.interview_type), "human_technical");
      assert.equal(String(aiPlans[0]?.language), "fa");

      const scheduledFor = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const scheduled = await tenantContext.run(organizationId, () =>
        authContext.run({ userId: actorUserId, source: "development-header" }, () =>
          service.scheduleTechnicalInterview({
            applicationId,
            interviewerUserId,
            scheduledFor,
            durationMinutes: 60,
            language: "fa",
          }),
        ),
      );

      assert.equal(scheduled.applicationId, applicationId);
      assert.equal(scheduled.interviewerUserId, interviewerUserId);
      assert.equal(scheduled.pipelineStage, "interview");
      assert.equal(scheduled.durationMinutes, 60);

      const sessions = await database.sql`
        SELECT s.id::text, s.status, p.interview_type, p.status AS plan_status
        FROM interview_sessions s
        JOIN interview_plans p
          ON p.organization_id = s.organization_id AND p.id = s.interview_plan_id
        WHERE s.organization_id = ${organizationId}::uuid
          AND s.id = ${scheduled.sessionId}::uuid
        LIMIT 1
      `;
      assert.equal(String(sessions[0]?.status), "scheduled");
      assert.equal(String(sessions[0]?.interview_type), "human_technical");
      assert.equal(String(sessions[0]?.plan_status), "published");

      const assignments = await database.sql`
        SELECT interviewer_user_id::text, assigned_by_user_id::text, status, scheduled_for
        FROM interview_assignments
        WHERE organization_id = ${organizationId}::uuid
          AND interview_session_id = ${scheduled.sessionId}::uuid
          AND status <> 'cancelled'
      `;
      assert.equal(assignments.length, 1);
      assert.equal(String(assignments[0]?.interviewer_user_id), interviewerUserId);
      assert.equal(String(assignments[0]?.assigned_by_user_id), actorUserId);
      assert.equal(String(assignments[0]?.status), "assigned");

      const applications = await database.sql`
        SELECT pipeline_stage
        FROM applications
        WHERE organization_id = ${organizationId}::uuid
          AND id = ${applicationId}::uuid
      `;
      assert.equal(String(applications[0]?.pipeline_stage), "interview");

      const transitions = await database.sql`
        SELECT from_stage, to_stage, actor_user_id::text
        FROM application_stage_transitions
        WHERE organization_id = ${organizationId}::uuid
          AND application_id = ${applicationId}::uuid
        ORDER BY created_at DESC
        LIMIT 1
      `;
      assert.equal(String(transitions[0]?.from_stage), "screening");
      assert.equal(String(transitions[0]?.to_stage), "interview");
      assert.equal(String(transitions[0]?.actor_user_id), actorUserId);

      const options = await tenantContext.run(organizationId, () => service.getOptions());
      const scheduledOption = options.sessions.find((item) => item.sessionId === scheduled.sessionId);
      assert.ok(scheduledOption);
      assert.equal(scheduledOption.interviewerUserId, interviewerUserId);
      assert.equal(scheduledOption.interviewerName, "Technical Interviewer");
      assert.equal(scheduledOption.assignmentStatus, "assigned");
      assert.equal(scheduledOption.sessionStatus, "scheduled");
      assert.equal(scheduledOption.scheduledFor, scheduledFor);

      const pendingOption = options.sessions.find(
        (item) => item.applicationId === pendingApplicationId,
      );
      assert.ok(pendingOption);
      assert.equal(pendingOption.sessionId, undefined);
      assert.equal(pendingOption.sessionStatus, "needs_scheduling");
      assert.equal(pendingOption.interviewerMode, "ai");
      assert.equal(pendingOption.candidateName, "Pending Interview Candidate");
    } finally {
      await database.sql`DELETE FROM organizations WHERE id = ${organizationId}::uuid`;
      await database.sql`
        DELETE FROM users
        WHERE id IN (${actorUserId}::uuid, ${interviewerUserId}::uuid)
      `;
      await database.onModuleDestroy();
    }
  },
);

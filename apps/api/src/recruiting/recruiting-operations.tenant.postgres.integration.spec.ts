import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import postgres from "postgres";
import { AuthContextService } from "../auth/auth-context.service";
import type { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import { RecruitingOperationsService } from "./recruiting-operations.service";

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
  "M1 candidate/application mutations cannot cross tenant boundaries",
  { skip: !integrationDatabaseUrl },
  async () => {
    const database = createIntegrationDatabase();
    const tenantContext = new TenantContextService();
    const operations = new RecruitingOperationsService(
      database,
      tenantContext,
      new AuthContextService(),
    );
    const organizationA = randomUUID();
    const organizationB = randomUUID();
    const jobA = randomUUID();
    const jobB = randomUUID();
    const rubricA = randomUUID();
    const rubricB = randomUUID();
    const versionA = randomUUID();
    const versionB = randomUUID();
    const criterionA = randomUUID();
    const criterionB = randomUUID();
    const candidateB = randomUUID();
    const suffix = randomUUID();

    try {
      await database.sql`
        INSERT INTO organizations (id, name, slug)
        VALUES
          (${organizationA}::uuid, 'M1 Mutation Tenant A', ${`m1-mutation-a-${suffix}`}),
          (${organizationB}::uuid, 'M1 Mutation Tenant B', ${`m1-mutation-b-${suffix}`})
      `;
      await database.sql`
        INSERT INTO jobs (id, organization_id, title, status)
        VALUES
          (${jobA}::uuid, ${organizationA}::uuid, 'M1 Tenant A Job', 'open'),
          (${jobB}::uuid, ${organizationB}::uuid, 'M1 Tenant B Job', 'open')
      `;
      await database.sql`
        INSERT INTO rubrics (id, organization_id, job_id, name, status)
        VALUES
          (${rubricA}::uuid, ${organizationA}::uuid, ${jobA}::uuid, 'A Rubric', 'published'),
          (${rubricB}::uuid, ${organizationB}::uuid, ${jobB}::uuid, 'B Rubric', 'published')
      `;
      await database.sql`
        INSERT INTO rubric_versions (id, organization_id, rubric_id, version, status, published_at)
        VALUES
          (${versionA}::uuid, ${organizationA}::uuid, ${rubricA}::uuid, 1, 'published', now()),
          (${versionB}::uuid, ${organizationB}::uuid, ${rubricB}::uuid, 1, 'published', now())
      `;
      await database.sql`
        INSERT INTO rubric_criteria (
          id, organization_id, rubric_version_id, criterion_key, label, weight, required, display_order
        ) VALUES
          (${criterionA}::uuid, ${organizationA}::uuid, ${versionA}::uuid, 'criterion_a', 'Criterion A', 1, true, 0),
          (${criterionB}::uuid, ${organizationB}::uuid, ${versionB}::uuid, 'criterion_b', 'Criterion B', 1, true, 0)
      `;
      await database.sql`
        INSERT INTO candidates (id, organization_id, display_name, primary_email)
        VALUES (
          ${candidateB}::uuid,
          ${organizationB}::uuid,
          'Tenant B Candidate',
          ${`tenant-b-${suffix}@example.invalid`}
        )
      `;

      const createdA = await tenantContext.run(organizationA, () =>
        operations.createCandidate({
          displayName: 'Tenant A Candidate',
          primaryEmail: `tenant-a-${suffix}@example.invalid`,
        }),
      );
      const persistedA = await database.sql`
        SELECT organization_id::text
        FROM candidates
        WHERE id = ${createdA.id}::uuid
      `;
      assert.equal(String(persistedA[0]?.organization_id), organizationA);

      const applicationA = await tenantContext.run(organizationA, () =>
        operations.createApplication(jobA, {
          candidateId: createdA.id,
          source: 'tenant-isolation-test',
        }),
      );
      assert.equal(applicationA.rubricVersionId, versionA);

      await assert.rejects(
        tenantContext.run(organizationA, () =>
          operations.createApplication(jobA, { candidateId: candidateB }),
        ),
        (error: unknown) => error instanceof NotFoundException,
      );

      await assert.rejects(
        tenantContext.run(organizationA, () =>
          operations.createApplication(jobB, { candidateId: createdA.id }),
        ),
        (error: unknown) => error instanceof NotFoundException,
      );

      const leakedApplication = await database.sql`
        SELECT 1
        FROM applications
        WHERE organization_id = ${organizationA}::uuid
          AND (job_id = ${jobB}::uuid OR candidate_id = ${candidateB}::uuid)
        LIMIT 1
      `;
      assert.equal(leakedApplication.length, 0);
    } finally {
      await database.sql`
        DELETE FROM organizations
        WHERE id IN (${organizationA}::uuid, ${organizationB}::uuid)
      `;
      await database.onModuleDestroy();
    }
  },
);

test(
  "approved hiring request creates and links a job atomically",
  { skip: !integrationDatabaseUrl },
  async () => {
    const database = createIntegrationDatabase();
    const tenantContext = new TenantContextService();
    const authContext = new AuthContextService();
    const operations = new RecruitingOperationsService(database, tenantContext, authContext);
    const organizationId = randomUUID();
    const userId = randomUUID();
    const hiringRequestId = randomUUID();
    const suffix = randomUUID();

    try {
      await database.sql`
        INSERT INTO organizations (id, name, slug)
        VALUES (
          ${organizationId}::uuid,
          'Hiring Request Job Integration',
          ${`hiring-request-job-${suffix}`}
        )
      `;
      await database.sql`
        INSERT INTO users (id, email, display_name)
        VALUES (
          ${userId}::uuid,
          ${`hiring-request-job-${suffix}@example.invalid`},
          'HR Owner'
        )
      `;
      await database.sql`
        INSERT INTO hiring_requests (
          id, organization_id, title, hiring_team, headcount, business_reason, requirements,
          status, requester_user_id, hr_owner_user_id, submitted_at, reviewed_at
        ) VALUES (
          ${hiringRequestId}::uuid,
          ${organizationId}::uuid,
          'Senior .NET Developer',
          '.NET Platform',
          1,
          'Expand the backend platform team',
          ${database.sql.json(["C#", "ASP.NET Core", "SQL"] as never)},
          'approved',
          ${userId}::uuid,
          ${userId}::uuid,
          now(),
          now()
        )
      `;

      const created = await tenantContext.run(organizationId, () =>
        authContext.run({ userId, source: "development-header" }, () =>
          operations.createJob({
            hiringRequestId,
            title: "Senior .NET Developer",
            department: "Engineering",
            seniority: "Senior",
            summary: "Expand the backend platform team",
            requirements: [
              { name: "C#", requirementType: "must_have", weight: 1 },
              { name: "ASP.NET Core", requirementType: "must_have", weight: 1 },
              { name: "SQL", requirementType: "must_have", weight: 1 },
            ],
            rubricName: "Senior .NET Developer rubric",
            rubricCriteria: [
              {
                criterionKey: "dotnet_depth",
                label: ".NET technical depth",
                weight: 1,
                required: true,
                displayOrder: 0,
              },
            ],
          }),
        ),
      );

      assert.equal(created.hiringRequestId, hiringRequestId);
      assert.equal(created.hiringRequestStatus, "recruiting");

      const linked = await database.sql`
        SELECT status, linked_job_id::text
        FROM hiring_requests
        WHERE organization_id = ${organizationId}::uuid
          AND id = ${hiringRequestId}::uuid
        LIMIT 1
      `;
      assert.equal(String(linked[0]?.status), "recruiting");
      assert.equal(String(linked[0]?.linked_job_id), created.id);

      const job = await database.sql`
        SELECT title, status, department, seniority, summary
        FROM jobs
        WHERE organization_id = ${organizationId}::uuid
          AND id = ${created.id}::uuid
        LIMIT 1
      `;
      assert.equal(String(job[0]?.title), "Senior .NET Developer");
      assert.equal(String(job[0]?.status), "draft");
      assert.equal(String(job[0]?.department), "Engineering");
      assert.equal(String(job[0]?.seniority), "Senior");

      await assert.rejects(
        tenantContext.run(organizationId, () =>
          authContext.run({ userId, source: "development-header" }, () =>
            operations.createJob({
              hiringRequestId,
              title: "Should Not Be Created",
              requirements: [],
              rubricName: "Blocked rubric",
              rubricCriteria: [
                {
                  criterionKey: "blocked",
                  label: "Blocked",
                  weight: 1,
                  required: true,
                  displayOrder: 0,
                },
              ],
            }),
          ),
        ),
        (error: unknown) => error instanceof BadRequestException,
      );

      const duplicateJobs = await database.sql`
        SELECT count(*)::int AS count
        FROM jobs
        WHERE organization_id = ${organizationId}::uuid
          AND title = 'Should Not Be Created'
      `;
      assert.equal(Number(duplicateJobs[0]?.count ?? 0), 0);
    } finally {
      await database.sql`
        DELETE FROM organizations
        WHERE id = ${organizationId}::uuid
      `;
      await database.sql`
        DELETE FROM users
        WHERE id = ${userId}::uuid
      `;
      await database.onModuleDestroy();
    }
  },
);


test(
  "requisition-backed hire fills the request and closes the linked job",
  { skip: !integrationDatabaseUrl },
  async () => {
    const database = createIntegrationDatabase();
    const tenantContext = new TenantContextService();
    const authContext = new AuthContextService();
    const operations = new RecruitingOperationsService(database, tenantContext, authContext);
    const organizationId = randomUUID();
    const userId = randomUUID();
    const jobId = randomUUID();
    const rubricId = randomUUID();
    const rubricVersionId = randomUUID();
    const candidateId = randomUUID();
    const applicationId = randomUUID();
    const hiringRequestId = randomUUID();
    const suffix = randomUUID();

    try {
      await database.sql`
        INSERT INTO organizations (id, name, slug)
        VALUES (
          ${organizationId}::uuid,
          'Hiring Closure Integration',
          ${`hiring-closure-${suffix}`}
        )
      `;
      await database.sql`
        INSERT INTO users (id, email, display_name)
        VALUES (
          ${userId}::uuid,
          ${`hiring-closure-${suffix}@example.invalid`},
          'Hiring Closure Reviewer'
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
          '.NET Hiring Rubric',
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
          '.NET depth',
          1,
          true,
          0
        )
      `;
      await database.sql`
        INSERT INTO candidates (id, organization_id, display_name, primary_email)
        VALUES (
          ${candidateId}::uuid,
          ${organizationId}::uuid,
          'Hire Candidate',
          ${`hire-candidate-${suffix}@example.invalid`}
        )
      `;
      await database.sql`
        INSERT INTO applications (
          id, organization_id, job_id, candidate_id, rubric_version_id, status, pipeline_stage, source
        ) VALUES (
          ${applicationId}::uuid,
          ${organizationId}::uuid,
          ${jobId}::uuid,
          ${candidateId}::uuid,
          ${rubricVersionId}::uuid,
          'active',
          'review',
          'integration-test'
        )
      `;
      await database.sql`
        INSERT INTO hiring_requests (
          id, organization_id, title, hiring_team, headcount, business_reason, requirements,
          status, requester_user_id, hr_owner_user_id, linked_job_id, submitted_at, reviewed_at
        ) VALUES (
          ${hiringRequestId}::uuid,
          ${organizationId}::uuid,
          'Senior .NET Developer',
          '.NET Platform',
          1,
          'Backfill senior backend role',
          '["C#", "ASP.NET Core"]'::jsonb,
          'recruiting',
          ${userId}::uuid,
          ${userId}::uuid,
          ${jobId}::uuid,
          now(),
          now()
        )
      `;
      await database.sql`
        INSERT INTO application_technical_approvals (
          organization_id, hiring_request_id, application_id, approver_user_id, decision, feedback
        ) VALUES (
          ${organizationId}::uuid,
          ${hiringRequestId}::uuid,
          ${applicationId}::uuid,
          ${userId}::uuid,
          'approve',
          'Technical interview approved for hire'
        )
      `;

      const decision = await tenantContext.run(organizationId, () =>
        authContext.run({ userId, source: "development-header" }, () =>
          operations.submitHiringDecision(applicationId, {
            decision: "hire",
            reason: "Approved after technical interview and human review",
          }),
        ),
      );
      assert.equal(decision.decision, "hire");

      const application = await database.sql`
        SELECT status, pipeline_stage
        FROM applications
        WHERE organization_id = ${organizationId}::uuid
          AND id = ${applicationId}::uuid
      `;
      assert.equal(String(application[0]?.status), "closed");
      assert.equal(String(application[0]?.pipeline_stage), "hired");

      const request = await database.sql`
        SELECT status
        FROM hiring_requests
        WHERE organization_id = ${organizationId}::uuid
          AND id = ${hiringRequestId}::uuid
      `;
      assert.equal(String(request[0]?.status), "filled");

      const job = await database.sql`
        SELECT status
        FROM jobs
        WHERE organization_id = ${organizationId}::uuid
          AND id = ${jobId}::uuid
      `;
      assert.equal(String(job[0]?.status), "closed");
    } finally {
      await database.sql`DELETE FROM organizations WHERE id = ${organizationId}::uuid`;
      await database.sql`DELETE FROM users WHERE id = ${userId}::uuid`;
      await database.onModuleDestroy();
    }
  },
);


test(
  "draft job can be edited and published with its draft rubric",
  { skip: !integrationDatabaseUrl },
  async () => {
    const database = createIntegrationDatabase();
    const tenantContext = new TenantContextService();
    const authContext = new AuthContextService();
    const operations = new RecruitingOperationsService(database, tenantContext, authContext);
    const organizationId = randomUUID();
    const userId = randomUUID();
    const suffix = randomUUID();

    try {
      await database.sql`
        INSERT INTO organizations (id, name, slug)
        VALUES (
          ${organizationId}::uuid,
          'Job Editing Integration',
          ${`job-editing-${suffix}`}
        )
      `;
      await database.sql`
        INSERT INTO users (id, email, display_name)
        VALUES (
          ${userId}::uuid,
          ${`job-editing-${suffix}@example.invalid`},
          'Job Editing Reviewer'
        )
      `;

      const created = await tenantContext.run(organizationId, () =>
        authContext.run({ userId, source: "development-header" }, () =>
          operations.createJob({
            title: "Draft Backend Engineer",
            department: "Engineering",
            requirements: [
              { name: "C#", requirementType: "must_have", weight: 1 },
            ],
            rubricName: "Backend rubric",
            rubricCriteria: [
              {
                criterionKey: "backend_depth",
                label: "Backend technical depth",
                weight: 1,
                required: true,
                displayOrder: 0,
              },
            ],
          }),
        ),
      );

      const updated = await tenantContext.run(organizationId, () =>
        operations.updateJob(created.id, {
          title: "Senior Backend Engineer",
          requirements: [
            { name: "C#", requirementType: "must_have", weight: 1 },
            { name: "SQL", requirementType: "must_have", weight: 1 },
          ],
        }),
      );
      assert.equal(String(updated.title), "Senior Backend Engineer");

      const published = await tenantContext.run(organizationId, () =>
        operations.publishJob(created.id),
      );
      assert.equal(published.status, "open");
      assert.equal(published.rubricPublished, true);
      assert.equal(published.rubricVersion, 1);

      const jobs = await database.sql`
        SELECT status, title
        FROM jobs
        WHERE organization_id = ${organizationId}::uuid
          AND id = ${created.id}::uuid
        LIMIT 1
      `;
      assert.equal(String(jobs[0]?.status), "open");
      assert.equal(String(jobs[0]?.title), "Senior Backend Engineer");

      const requirements = await database.sql`
        SELECT name
        FROM job_requirements
        WHERE organization_id = ${organizationId}::uuid
          AND job_id = ${created.id}::uuid
        ORDER BY name
      `;
      assert.deepEqual(requirements.map((row) => String(row.name)), ["C#", "SQL"]);

      const rubrics = await database.sql`
        SELECT rv.status, rv.version
        FROM rubrics r
        JOIN rubric_versions rv
          ON rv.organization_id = r.organization_id
         AND rv.rubric_id = r.id
        WHERE r.organization_id = ${organizationId}::uuid
          AND r.job_id = ${created.id}::uuid
        ORDER BY rv.version DESC
        LIMIT 1
      `;
      assert.equal(String(rubrics[0]?.status), "published");
      assert.equal(Number(rubrics[0]?.version), 1);
    } finally {
      await database.sql`
        DELETE FROM organizations
        WHERE id = ${organizationId}::uuid
      `;
      await database.sql`
        DELETE FROM users
        WHERE id = ${userId}::uuid
      `;
      await database.onModuleDestroy();
    }
  },
);


test(
  "explicit cascade candidate deletion removes linked applications without crossing tenants",
  { skip: !integrationDatabaseUrl },
  async () => {
    const database = createIntegrationDatabase();
    const tenantContext = new TenantContextService();
    const operations = new RecruitingOperationsService(
      database,
      tenantContext,
      new AuthContextService(),
    );
    const organizationA = randomUUID();
    const organizationB = randomUUID();
    const jobA = randomUUID();
    const rubricA = randomUUID();
    const versionA = randomUUID();
    const candidateA = randomUUID();
    const candidateB = randomUUID();
    const applicationA = randomUUID();
    const suffix = randomUUID();

    try {
      await database.sql`
        INSERT INTO organizations (id, name, slug)
        VALUES
          (${organizationA}::uuid, 'Cascade Delete Tenant A', ${`cascade-delete-a-${suffix}`}),
          (${organizationB}::uuid, 'Cascade Delete Tenant B', ${`cascade-delete-b-${suffix}`})
      `;
      await database.sql`
        INSERT INTO jobs (id, organization_id, title, status)
        VALUES (${jobA}::uuid, ${organizationA}::uuid, 'Cascade Delete Job', 'open')
      `;
      await database.sql`
        INSERT INTO rubrics (id, organization_id, job_id, name, status)
        VALUES (${rubricA}::uuid, ${organizationA}::uuid, ${jobA}::uuid, 'Cascade rubric', 'published')
      `;
      await database.sql`
        INSERT INTO rubric_versions (id, organization_id, rubric_id, version, status, published_at)
        VALUES (${versionA}::uuid, ${organizationA}::uuid, ${rubricA}::uuid, 1, 'published', now())
      `;
      await database.sql`
        INSERT INTO candidates (id, organization_id, display_name, primary_email)
        VALUES
          (${candidateA}::uuid, ${organizationA}::uuid, 'Cascade Candidate A', ${`cascade-a-${suffix}@example.invalid`}),
          (${candidateB}::uuid, ${organizationB}::uuid, 'Cascade Candidate B', ${`cascade-b-${suffix}@example.invalid`})
      `;
      await database.sql`
        INSERT INTO applications (
          id, organization_id, job_id, candidate_id, rubric_version_id, status, pipeline_stage, source
        ) VALUES (
          ${applicationA}::uuid,
          ${organizationA}::uuid,
          ${jobA}::uuid,
          ${candidateA}::uuid,
          ${versionA}::uuid,
          'active',
          'new',
          'integration-test'
        )
      `;

      const safeResult = await tenantContext.run(organizationA, () =>
        operations.bulkDeleteCandidates([candidateA, candidateB]),
      );
      assert.deepEqual(safeResult.deletedIds, []);
      assert.deepEqual(new Set(safeResult.blockedIds), new Set([candidateA, candidateB]));

      const cascadeResult = await tenantContext.run(organizationA, () =>
        operations.bulkDeleteCandidates([candidateA, candidateB], true),
      );
      assert.deepEqual(cascadeResult.deletedIds, [candidateA]);
      assert.deepEqual(cascadeResult.blockedIds, [candidateB]);

      const removedCandidate = await database.sql`
        SELECT 1 FROM candidates
        WHERE organization_id = ${organizationA}::uuid
          AND id = ${candidateA}::uuid
      `;
      assert.equal(removedCandidate.length, 0);

      const removedApplication = await database.sql`
        SELECT 1 FROM applications
        WHERE organization_id = ${organizationA}::uuid
          AND id = ${applicationA}::uuid
      `;
      assert.equal(removedApplication.length, 0);

      const preservedForeignCandidate = await database.sql`
        SELECT 1 FROM candidates
        WHERE organization_id = ${organizationB}::uuid
          AND id = ${candidateB}::uuid
      `;
      assert.equal(preservedForeignCandidate.length, 1);
    } finally {
      await database.sql`
        DELETE FROM organizations
        WHERE id IN (${organizationA}::uuid, ${organizationB}::uuid)
      `;
      await database.onModuleDestroy();
    }
  },
);

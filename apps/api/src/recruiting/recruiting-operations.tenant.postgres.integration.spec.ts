import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { NotFoundException } from "@nestjs/common";
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

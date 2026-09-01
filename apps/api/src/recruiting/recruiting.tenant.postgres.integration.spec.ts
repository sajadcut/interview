import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import type { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import { RecruitingService } from "./recruiting.service";

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
  "recruiting reads are tenant isolated against PostgreSQL",
  { skip: !integrationDatabaseUrl },
  async () => {
    const database = createIntegrationDatabase();
    const tenantContext = new TenantContextService();
    const recruiting = new RecruitingService(database, tenantContext);
    const organizationA = randomUUID();
    const organizationB = randomUUID();
    const jobA = randomUUID();
    const jobB = randomUUID();
    const candidateA = randomUUID();
    const candidateB = randomUUID();
    const suffix = randomUUID();

    try {
      await database.sql`
        INSERT INTO organizations (id, name, slug)
        VALUES
          (${organizationA}::uuid, 'Tenant Isolation A', ${`tenant-isolation-a-${suffix}`}),
          (${organizationB}::uuid, 'Tenant Isolation B', ${`tenant-isolation-b-${suffix}`})
      `;
      await database.sql`
        INSERT INTO jobs (id, organization_id, title, status)
        VALUES
          (${jobA}::uuid, ${organizationA}::uuid, 'Tenant A Job', 'open'),
          (${jobB}::uuid, ${organizationB}::uuid, 'Tenant B Job', 'open')
      `;
      await database.sql`
        INSERT INTO candidates (id, organization_id, display_name, primary_email)
        VALUES
          (${candidateA}::uuid, ${organizationA}::uuid, 'Tenant A Candidate', ${`a-${suffix}@example.invalid`}),
          (${candidateB}::uuid, ${organizationB}::uuid, 'Tenant B Candidate', ${`b-${suffix}@example.invalid`})
      `;

      const jobsForA = await tenantContext.run(organizationA, () => recruiting.listJobs());
      assert.deepEqual(jobsForA.map((job) => job.id), [jobA]);
      assert.equal(jobsForA.some((job) => job.id === jobB), false);

      const jobsForB = await tenantContext.run(organizationB, () => recruiting.listJobs());
      assert.deepEqual(jobsForB.map((job) => job.id), [jobB]);
      assert.equal(jobsForB.some((job) => job.id === jobA), false);

      const candidatesForA = await tenantContext.run(organizationA, () => recruiting.listCandidates());
      assert.deepEqual(candidatesForA.map((candidate) => candidate.id), [candidateA]);
      assert.equal(candidatesForA.some((candidate) => candidate.id === candidateB), false);

      const crossTenantCandidate = await tenantContext.run(organizationA, () =>
        recruiting.getCandidateWorkspace(candidateB),
      );
      assert.equal(crossTenantCandidate, null);

      const crossTenantJob = await tenantContext.run(organizationA, () => recruiting.getJobWorkspace(jobB));
      assert.equal(crossTenantJob, null);
    } finally {
      await database.sql`DELETE FROM organizations WHERE id IN (${organizationA}::uuid, ${organizationB}::uuid)`;
      await database.onModuleDestroy();
    }
  },
);

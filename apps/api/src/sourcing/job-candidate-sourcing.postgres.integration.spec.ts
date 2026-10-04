import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import type { AiJobQueueService } from "../ai/ai-job-queue.service";
import { AuthContextService } from "../auth/auth-context.service";
import type { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import type { CandidateSourceRegistry } from "./candidate-source.registry";
import { SourcingAgentService } from "./sourcing-agent.service";
import type { SourcingService } from "./sourcing.service";
import { TalentOperationsService } from "./talent-operations.service";

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
  "job-first sourcing ranks resume-backed internal talent by deterministic evidence",
  { skip: !integrationDatabaseUrl },
  async () => {
    const database = createIntegrationDatabase();
    const tenantContext = new TenantContextService();
    const talent = new TalentOperationsService(
      database,
      tenantContext,
      new AuthContextService(),
    );
    const organizationId = randomUUID();
    const jobId = randomUUID();
    const strongCandidateId = randomUUID();
    const weakCandidateId = randomUUID();
    const suffix = randomUUID();

    try {
      await database.sql`
        INSERT INTO organizations (id, name, slug)
        VALUES (
          ${organizationId}::uuid,
          'Job First Sourcing',
          ${`job-first-sourcing-${suffix}`}
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
        INSERT INTO job_requirements (
          organization_id, job_id, requirement_type, name, weight
        ) VALUES
          (${organizationId}::uuid, ${jobId}::uuid, 'must_have', 'C#', 1),
          (${organizationId}::uuid, ${jobId}::uuid, 'must_have', 'ASP.NET Core', 1),
          (${organizationId}::uuid, ${jobId}::uuid, 'nice_to_have', 'PostgreSQL', 0.5)
      `;
      await database.sql`
        INSERT INTO candidates (id, organization_id, display_name, "current_role")
        VALUES
          (${strongCandidateId}::uuid, ${organizationId}::uuid, 'Strong .NET Candidate', '.NET Developer'),
          (${weakCandidateId}::uuid, ${organizationId}::uuid, 'Java Candidate', 'Java Developer')
      `;
      await database.sql`
        INSERT INTO talent_pool_entries (organization_id, candidate_id, status)
        VALUES
          (${organizationId}::uuid, ${strongCandidateId}::uuid, 'active'),
          (${organizationId}::uuid, ${weakCandidateId}::uuid, 'active')
      `;
      await database.sql`
        INSERT INTO candidate_skills (
          organization_id, candidate_id, skill_key, skill_label,
          verification_state, confidence, source_reference
        ) VALUES
          (${organizationId}::uuid, ${strongCandidateId}::uuid, 'csharp', 'C#', 'unverified', 0.9, 'resume:test'),
          (${organizationId}::uuid, ${strongCandidateId}::uuid, 'aspnet-core', 'ASP.NET Core', 'unverified', 0.9, 'resume:test'),
          (${organizationId}::uuid, ${strongCandidateId}::uuid, 'postgresql', 'PostgreSQL', 'unverified', 0.8, 'resume:test'),
          (${organizationId}::uuid, ${weakCandidateId}::uuid, 'java', 'Java', 'unverified', 0.9, 'resume:test')
      `;

      const matches = await tenantContext.run(organizationId, () =>
        talent.listJobTalentMatches(jobId, 10),
      );

      assert.equal(matches.length, 2);
      assert.equal(matches[0]?.candidateId, strongCandidateId);
      assert.ok((matches[0]?.matchScore ?? 0) > (matches[1]?.matchScore ?? 0));
      assert.ok(matches[0]?.matchedRequirements.includes("C#"));
      assert.ok(matches[0]?.matchedRequirements.includes("ASP.NET Core"));
      assert.ok(matches[1]?.missingMustHaveRequirements.includes("C#"));
    } finally {
      await database.sql`DELETE FROM organizations WHERE id = ${organizationId}::uuid`;
      await database.onModuleDestroy();
    }
  },
);

test(
  "HR acceptance promotes an external discovered profile into talent and a job application",
  { skip: !integrationDatabaseUrl },
  async () => {
    const database = createIntegrationDatabase();
    const tenantContext = new TenantContextService();
    const talent = new TalentOperationsService(
      database,
      tenantContext,
      new AuthContextService(),
    );
    const agent = new SourcingAgentService(
      database,
      tenantContext,
      {} as AiJobQueueService,
      {} as CandidateSourceRegistry,
      {} as SourcingService,
      talent,
    );

    const organizationId = randomUUID();
    const jobId = randomUUID();
    const rubricId = randomUUID();
    const rubricVersionId = randomUUID();
    const runId = randomUUID();
    const discoveredCandidateId = randomUUID();
    const suffix = randomUUID();

    try {
      await database.sql`
        INSERT INTO organizations (id, name, slug)
        VALUES (
          ${organizationId}::uuid,
          'External Candidate Acceptance',
          ${`external-acceptance-${suffix}`}
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
        INSERT INTO job_requirements (
          organization_id, job_id, requirement_type, name, weight
        ) VALUES
          (${organizationId}::uuid, ${jobId}::uuid, 'must_have', 'C#', 1),
          (${organizationId}::uuid, ${jobId}::uuid, 'must_have', 'ASP.NET Core', 1)
      `;
      await database.sql`
        INSERT INTO rubrics (id, organization_id, job_id, name, status)
        VALUES (
          ${rubricId}::uuid,
          ${organizationId}::uuid,
          ${jobId}::uuid,
          '.NET rubric',
          'published'
        )
      `;
      await database.sql`
        INSERT INTO rubric_versions (
          id, organization_id, rubric_id, version, status, published_at
        ) VALUES (
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
          organization_id, rubric_version_id, criterion_key, label,
          weight, required, display_order
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
        INSERT INTO sourcing_runs (
          id, organization_id, job_id, status, strategy,
          requested_source_type, source_policy_version, attempt_count, result_count
        ) VALUES (
          ${runId}::uuid,
          ${organizationId}::uuid,
          ${jobId}::uuid,
          'succeeded',
          '{"providerKey":"people_data_labs"}'::jsonb,
          'approved_external',
          'source-policy-v1',
          1,
          1
        )
      `;
      await database.sql`
        INSERT INTO discovered_candidates (
          id, organization_id, sourcing_run_id, source_type,
          source_external_key, normalized_identity, profile_snapshot,
          retrieval_score, pre_interview_match_score,
          dedupe_state, review_state, source_provenance, source_observed_at
        ) VALUES (
          ${discoveredCandidateId}::uuid,
          ${organizationId}::uuid,
          ${runId}::uuid,
          'approved_external',
          'pdl-person-1',
          ${database.sql.json({ email: `external-${suffix}@example.invalid` } as never)},
          ${database.sql.json({
            displayName: 'External .NET Candidate',
            currentRole: 'Senior .NET Engineer',
            currentCompany: 'Example Co',
            skills: ['C#', 'ASP.NET Core'],
            evidenceSummary: ['Provider profile skills'],
          } as never)},
          0.91,
          100,
          'unresolved',
          'new',
          ${database.sql.json({
            providerKey: 'people_data_labs',
            sourceType: 'approved_external',
            observedAt: new Date().toISOString(),
            retrievedAt: new Date().toISOString(),
            sourceUrl: 'https://example.invalid/profile/1',
            evidenceReferences: ['people_data_labs:person:pdl-person-1'],
          } as never)},
          now()
        )
      `;

      const accepted = await tenantContext.run(organizationId, () =>
        agent.acceptDiscoveredCandidate(discoveredCandidateId),
      );

      assert.equal(accepted.importedCandidate, true);
      assert.equal(accepted.applicationAlreadyExisted, false);
      assert.ok(accepted.preInterviewMatchScore > 0);

      const candidate = await database.sql`
        SELECT display_name, primary_email
        FROM candidates
        WHERE organization_id = ${organizationId}::uuid
          AND id = ${accepted.candidateId}::uuid
      `;
      assert.equal(String(candidate[0]?.display_name), "External .NET Candidate");

      const application = await database.sql`
        SELECT job_id::text, pipeline_stage, source, pre_interview_match_score
        FROM applications
        WHERE organization_id = ${organizationId}::uuid
          AND id = ${accepted.applicationId}::uuid
      `;
      assert.equal(String(application[0]?.job_id), jobId);
      assert.equal(String(application[0]?.pipeline_stage), "new");
      assert.match(String(application[0]?.source), /^sourcing:approved_external:/);
      assert.ok(Number(application[0]?.pre_interview_match_score ?? 0) > 0);

      const talentEntry = await database.sql`
        SELECT status
        FROM talent_pool_entries
        WHERE organization_id = ${organizationId}::uuid
          AND candidate_id = ${accepted.candidateId}::uuid
      `;
      assert.equal(String(talentEntry[0]?.status), "active");

      const discovered = await database.sql`
        SELECT candidate_id::text, review_state, dedupe_state
        FROM discovered_candidates
        WHERE organization_id = ${organizationId}::uuid
          AND id = ${discoveredCandidateId}::uuid
      `;
      assert.equal(String(discovered[0]?.candidate_id), accepted.candidateId);
      assert.equal(String(discovered[0]?.review_state), "accepted");
      assert.equal(String(discovered[0]?.dedupe_state), "resolved_internal");
    } finally {
      await database.sql`DELETE FROM organizations WHERE id = ${organizationId}::uuid`;
      await database.onModuleDestroy();
    }
  },
);

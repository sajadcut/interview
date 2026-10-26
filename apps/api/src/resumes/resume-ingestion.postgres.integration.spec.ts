import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import type { DatabaseService } from "../database/database.service";
import { CandidateIntelligenceService } from "../recruiting/candidate-intelligence.service";
import type { StorageService } from "../storage/storage.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import { ResumeChunker } from "./resume-chunker";
import type { ResumeEmbeddingProvider } from "./resume-embedding-provider";
import { ResumeIngestionService } from "./resume-ingestion.service";
import { ResumeParser } from "./resume-parser";
import { ResumeTextExtractor } from "./resume-text-extractor";

const integrationDatabaseUrl = process.env.AUTH_INTEGRATION_DATABASE_URL;

function createIntegrationDatabase(): DatabaseService {
  if (!integrationDatabaseUrl) throw new Error("AUTH_INTEGRATION_DATABASE_URL is required");
  const sql = postgres(integrationDatabaseUrl, { max: 1, idle_timeout: 20, connect_timeout: 10 });
  return { sql, onModuleDestroy: async () => sql.end({ timeout: 5 }) } as DatabaseService;
}

function createStorage(database: DatabaseService, tenant: TenantContextService): StorageService {
  const data = new Map<string, Uint8Array>();
  return {
    save: async (input: { originalName: string; mimeType: string; data: Uint8Array }) => {
      const organizationId = tenant.require().organizationId;
      const id = randomUUID();
      const key = `${organizationId}/${id}/${input.originalName}`;
      const sha256 = createHash("sha256").update(input.data).digest("hex");
      data.set(id, input.data);
      await database.sql`
        INSERT INTO files (id, organization_id, storage_key, original_name, mime_type, size_bytes, sha256)
        VALUES (${id}::uuid, ${organizationId}::uuid, ${key}, ${input.originalName}, ${input.mimeType}, ${input.data.byteLength}, ${sha256})
      `;
      return { id, key, sha256 };
    },
    getById: async (id: string) => data.get(id) ?? new Uint8Array(),
    createReadReferenceById: async (id: string) => `memory://${id}`,
    deleteById: async (id: string) => {
      const organizationId = tenant.require().organizationId;
      data.delete(id);
      await database.sql`DELETE FROM files WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid`;
    },
  } as unknown as StorageService;
}

test(
  "resume ingestion is tenant isolated, idempotent and persists profile evidence against PostgreSQL",
  { skip: !integrationDatabaseUrl },
  async () => {
    const database = createIntegrationDatabase();
    const tenant = new TenantContextService();
    const storage = createStorage(database, tenant);
    const embeddings: ResumeEmbeddingProvider = {
      configured: true,
      embed: async (texts) => ({
        provider: "integration-test",
        model: "resume-test-embedding-v1",
        dimensions: 3,
        vectors: texts.map((_, index) => [index + 0.1, index + 0.2, index + 0.3]),
      }),
    };
    const service = new ResumeIngestionService(
      database,
      tenant,
      storage,
      new ResumeTextExtractor(),
      new ResumeParser(),
      new ResumeChunker(),
      embeddings,
    );
    const orgA = randomUUID();
    const orgB = randomUUID();
    const candidateA = randomUUID();
    const candidateB = randomUUID();
    const suffix = randomUUID();
    const source = Buffer.from(
      `Sara Ahmadi\nsara-${suffix}@example.invalid\nLocation: Tehran\n\nSkills\nTypeScript, Node.js, PostgreSQL\n\nWork Experience\nSenior Backend Engineer — Example Co | 2022 - Present\nBuilt Node.js APIs with PostgreSQL for production systems.`,
    );

    try {
      await database.sql`
        INSERT INTO organizations (id, name, slug) VALUES
          (${orgA}::uuid, 'Resume Org A', ${`resume-a-${suffix}`}),
          (${orgB}::uuid, 'Resume Org B', ${`resume-b-${suffix}`})
      `;
      await database.sql`
        INSERT INTO candidates (id, organization_id, display_name) VALUES
          (${candidateA}::uuid, ${orgA}::uuid, 'Sara Ahmadi'),
          (${candidateB}::uuid, ${orgB}::uuid, 'Other Candidate')
      `;

      const first = await tenant.run(orgA, () => service.ingest(candidateA, {
        originalName: "sara-resume.txt",
        mimeType: "text/plain",
        data: source,
      }));
      const replay = await tenant.run(orgA, () => service.ingest(candidateA, {
        originalName: "renamed-resume.txt",
        mimeType: "text/plain",
        data: source,
      }));

      assert.equal(first.id, replay.id);
      assert.equal(first.status, "completed");
      assert.ok(first.chunkCount > 0);
      assert.equal(first.embeddedChunkCount, first.chunkCount);
      assert.ok(first.evidenceCount >= 3);
      assert.equal(first.structuredProfile.currentRole, "Senior Backend Engineer");

      const skills = await database.sql`
        SELECT skill_key FROM candidate_skills
        WHERE organization_id = ${orgA}::uuid AND candidate_id = ${candidateA}::uuid
      `;
      assert.equal(skills.some((row) => row.skill_key === "typescript"), true);

      // Phase-1 skill graph: literal resume text -> taxonomy -> candidate-scoped evidence.
      // Duplicate uploads must never duplicate claims or turn them into verified skills.
      const anchoredClaims = await database.sql`
        SELECT st.skill_key, rc.claim_text, rc.start_char, rc.end_char,
               rc.review_state, rc.extraction_confidence, e.source_reference
        FROM resume_skill_claims rc
        JOIN skill_taxonomy st
          ON st.organization_id = rc.organization_id AND st.id = rc.skill_id
        JOIN evidence e
          ON e.organization_id = rc.organization_id AND e.id = rc.evidence_id
        WHERE rc.organization_id = ${orgA}::uuid
          AND rc.candidate_id = ${candidateA}::uuid
          AND rc.resume_id = ${first.id}::uuid
      `;
      const postgresClaims = anchoredClaims.filter((row) => row.skill_key === "postgresql");
      assert.equal(postgresClaims.length, 1);
      const postgresClaim = postgresClaims[0]!;
      assert.equal(postgresClaim.review_state, "pending");
      assert.equal(
        source.toString("utf8").slice(Number(postgresClaim.start_char), Number(postgresClaim.end_char)),
        postgresClaim.claim_text,
      );
      assert.match(String(postgresClaim.source_reference), /^resume:[^#]+#skill:postgresql$/);

      const intelligence = new CandidateIntelligenceService(database, tenant);
      const orgAWorkspace = await tenant.run(orgA, () => intelligence.getWorkspace(candidateA));
      const orgBWorkspace = await tenant.run(orgB, () => intelligence.getWorkspace(candidateB));
      assert.equal(orgAWorkspace.resumeSkillClaims.some((claim) =>
        claim.skillKey === "postgresql" && claim.reviewState === "pending"), true);
      assert.equal(orgAWorkspace.resumeSkillClaims.some((claim) =>
        claim.skillKey === "postgresql" && claim.claimText.includes("PostgreSQL")), true);
      assert.equal(orgBWorkspace.resumeSkillClaims.length, 0);
      assert.equal(orgBWorkspace.jobSkillRequirements.length, 0);

      // Composite tenant FKs reject cross-organization skill/resume associations even when IDs exist.
      await assert.rejects(() => database.sql`
        INSERT INTO resume_skill_claims (
          organization_id, candidate_id, resume_id, skill_id, source_reference,
          claim_text, start_char, end_char, extraction_confidence,
          taxonomy_version, parser_version
        )
        SELECT ${orgB}::uuid, ${candidateB}::uuid, ${first.id}::uuid,
               st.id, 'malicious-cross-tenant', 'PostgreSQL', 0, 10, 0.99,
               'v1', 'test'
        FROM skill_taxonomy st
        WHERE st.organization_id = ${orgA}::uuid AND st.skill_key = 'postgresql'
      `);

      const resumeRows = await database.sql`
        SELECT count(*)::int AS count FROM resumes
        WHERE organization_id = ${orgA}::uuid AND candidate_id = ${candidateA}::uuid
      `;
      assert.equal(resumeRows[0]?.count, 1);

      const embeddingRows = await database.sql`
        SELECT count(*)::int AS count, min(dimensions)::int AS dimensions,
               bool_and(jsonb_typeof(embedding) = 'array') AS all_arrays
        FROM resume_chunk_embeddings
        WHERE organization_id = ${orgA}::uuid AND resume_id = ${first.id}::uuid
      `;
      assert.equal(embeddingRows[0]?.count, first.chunkCount);
      assert.equal(embeddingRows[0]?.dimensions, 3);
      assert.equal(embeddingRows[0]?.all_arrays, true);

      await assert.rejects(
        () => tenant.run(orgB, () => service.getResume(candidateB, first.id)),
        /Resume not found/,
      );
    } finally {
      await database.sql`DELETE FROM organizations WHERE id IN (${orgA}::uuid, ${orgB}::uuid)`;
      await database.onModuleDestroy();
    }
  },
);

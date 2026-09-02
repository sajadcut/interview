import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import type { DatabaseService } from "../database/database.service";
import type { StorageService } from "../storage/storage.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import { ResumeChunker } from "./resume-chunker";
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
    const service = new ResumeIngestionService(
      database,
      tenant,
      storage,
      new ResumeTextExtractor(),
      new ResumeParser(),
      new ResumeChunker(),
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
      assert.ok(first.evidenceCount >= 3);
      assert.equal(first.structuredProfile.currentRole, "Senior Backend Engineer");

      const skills = await database.sql`
        SELECT skill_key FROM candidate_skills
        WHERE organization_id = ${orgA}::uuid AND candidate_id = ${candidateA}::uuid
      `;
      assert.equal(skills.some((row) => row.skill_key === "typescript"), true);

      const resumeRows = await database.sql`
        SELECT count(*)::int AS count FROM resumes
        WHERE organization_id = ${orgA}::uuid AND candidate_id = ${candidateA}::uuid
      `;
      assert.equal(resumeRows[0]?.count, 1);

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

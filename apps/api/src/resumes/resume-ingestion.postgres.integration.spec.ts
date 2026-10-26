import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import type { DatabaseService } from "../database/database.service";
import { CandidateIntelligenceService } from "../recruiting/candidate-intelligence.service";
import { SkillEvidenceService } from "../recruiting/skill-evidence.service";
import { AuthContextService } from "../auth/auth-context.service";
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
    const actorId = randomUUID();
    const jobId = randomUUID();
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
        INSERT INTO users (id, email, display_name)
        VALUES (${actorId}::uuid, ${`reviewer-${suffix}@example.invalid`}, 'Skills Reviewer')
      `;
      await database.sql`
        INSERT INTO jobs (id, organization_id, title, status)
        VALUES (${jobId}::uuid, ${orgA}::uuid, 'Backend Developer', 'draft')
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

      // Simulate a previously processed resume under an older parser contract:
      // the same file bytes are reprocessed, claim source evidence is recreated,
      // and active claims are rebound instead of retaining orphaned evidence.
      await database.sql`
        UPDATE resumes SET parser_version = 'resume-structure-legacy'
        WHERE organization_id = ${orgA}::uuid AND id = ${first.id}::uuid
      `;
      const reparsed = await tenant.run(orgA, () => service.ingest(candidateA, {
        originalName: "sara-resume-reprocess.txt",
        mimeType: "text/plain",
        data: source,
      }));
      assert.equal(reparsed.id, first.id);
      const claimsAfterReprocess = await database.sql`
        SELECT rc.id, rc.is_current, rc.evidence_id, e.source_reference, rc.claim_text
        FROM resume_skill_claims rc
        JOIN skill_taxonomy st ON st.organization_id = rc.organization_id AND st.id = rc.skill_id
        JOIN evidence e ON e.organization_id=rc.organization_id AND e.id=rc.evidence_id
        WHERE rc.organization_id = ${orgA}::uuid AND rc.resume_id = ${first.id}::uuid
          AND st.skill_key = 'postgresql'
      `;
      assert.equal(claimsAfterReprocess.length, 1);
      assert.equal(claimsAfterReprocess[0]?.is_current, true);
      assert.ok(claimsAfterReprocess[0]?.evidence_id);
      assert.equal(claimsAfterReprocess[0]?.claim_text, postgresClaim.claim_text);
      assert.equal(claimsAfterReprocess[0]?.source_reference, postgresClaim.source_reference);


      const intelligence = new CandidateIntelligenceService(database, tenant);
      const orgAWorkspace = await tenant.run(orgA, () => intelligence.getWorkspace(candidateA));
      const orgBWorkspace = await tenant.run(orgB, () => intelligence.getWorkspace(candidateB));
      assert.equal(orgAWorkspace.resumeSkillClaims.some((claim) =>
        claim.skillKey === "postgresql" && claim.reviewState === "pending"), true);
      assert.equal(orgAWorkspace.resumeSkillClaims.some((claim) =>
        claim.skillKey === "postgresql" && claim.claimText.includes("PostgreSQL")), true);
      assert.equal(orgBWorkspace.resumeSkillClaims.length, 0);
      assert.equal(orgBWorkspace.jobSkillRequirements.length, 0);

      // Human review actions remain independent from the resume parser's raw evidence
      // and from candidate's unverified declared skill list.
      const auth = new AuthContextService();
      const skillEvidence = new SkillEvidenceService(database, tenant, auth);
      const current = await tenant.run(orgA, () => skillEvidence.listJobSkills(jobId));
      assert.deepEqual(current, []);
      const requiredSkill = {
        skillKey: "postgresql", nameEn: "PostgreSQL", nameFa: "پستگرس",
        category: "technical" as const, requiredLevel: 4, weight: 2,
        required: true, minimumEvidenceCount: 2,
      };
      const created = await tenant.run(orgA, () => skillEvidence.replaceJobSkills(jobId, [requiredSkill]));
      assert.equal(created[0]?.requiredLevel, 4);
      assert.equal(created[0]?.requirementVersion, 1);
      const unchanged = await tenant.run(orgA, () => skillEvidence.replaceJobSkills(jobId, [requiredSkill]));
      assert.equal(unchanged[0]?.requirementVersion, 1);
      const updated = await tenant.run(orgA, () => skillEvidence.replaceJobSkills(jobId, [{ ...requiredSkill, requiredLevel: 5 }]));
      assert.equal(updated[0]?.requirementVersion, 2);
      await assert.rejects(
        () => tenant.run(orgB, () => skillEvidence.listJobSkills(jobId)),
        /Job not found/,
      );

      const claim = orgAWorkspace.resumeSkillClaims.find((item) => item.skillKey === "postgresql");
      assert.ok(claim);
      assert.equal(claim.reviewVersion, 0);
      await assert.rejects(
        () => tenant.run(orgA, () => skillEvidence.reviewResumeClaim(candidateA, claim.id, {
          reviewState: "confirmed", reviewReason: "Evidence matches original statement", expectedVersion: 0,
        })),
        /Authenticated reviewer required/,
      );
      await database.sql`
        INSERT INTO skill_taxonomy (organization_id, skill_key, name_en, category)
        VALUES (${orgA}::uuid, 'redis', 'Redis', 'technical')
        ON CONFLICT (organization_id, skill_key) DO NOTHING
      `;
      const reviewed = await tenant.run(orgA, () => auth.run({
        userId: actorId, source: "session" as const,
      }, () => skillEvidence.reviewResumeClaim(candidateA, claim.id, {
        reviewState: "corrected", correctedSkillKey: "redis",
        reviewReason: "Human verified incorrect skill mapping", expectedVersion: 0,
      })));
      assert.equal(reviewed.reviewState, "corrected");
      assert.equal(reviewed.reviewVersion, 1);
      assert.equal(reviewed.skillKey, "redis");
      await assert.rejects(
        () => tenant.run(orgA, () => auth.run({
          userId: actorId, source: "session" as const,
        }, () => skillEvidence.reviewResumeClaim(candidateA, claim.id, {
          reviewState: "confirmed", reviewReason: "Outdated concurrent review", expectedVersion: 0,
        }))),
        /Stale resume skill claim review version/,
      );
      await assert.rejects(
        () => tenant.run(orgB, () => auth.run({
          userId: actorId, source: "session" as const,
        }, () => skillEvidence.reviewResumeClaim(candidateB, claim.id, {
          reviewState: "rejected", reviewReason: "Cross tenant attempt rejected", expectedVersion: 1,
        }))),
        /Resume skill claim not found/,
      );

      const next = await tenant.run(orgA, () => auth.run({
        userId: actorId, source: "session" as const,
      }, () => skillEvidence.reviewResumeClaim(candidateA, claim.id, {
        reviewState: "confirmed", reviewReason: "Mapping accepted after human review", expectedVersion: 1,
      })));
      assert.equal(next.reviewVersion, 2);
      assert.equal(next.skillKey, "redis");
      const history = await tenant.run(orgA, () => skillEvidence.reviewHistory(candidateA, claim.id));
      assert.deepEqual(history.map((event) => event.reviewVersion), [1, 2]);
      assert.equal(history[0]?.previousSkillKey, "postgresql");
      assert.equal(history[0]?.skillKey, "redis");
      await assert.rejects(
        () => tenant.run(orgB, () => skillEvidence.reviewHistory(candidateB, claim.id)),
        /Resume skill claim not found/,
      );
      const afterReview = await tenant.run(orgA, () => intelligence.getWorkspace(candidateA));
      const updatedClaim = afterReview.resumeSkillClaims.find((item) => item.id === claim.id);
      assert.equal(updatedClaim?.skillKey, "redis");
      assert.equal(updatedClaim?.reviewVersion, 2);
      assert.equal(updatedClaim?.sourceReference, claim.sourceReference);
      const resumeEvidence = await database.sql`
        SELECT source_reference, metadata FROM evidence
        WHERE organization_id=${orgA}::uuid AND candidate_id=${candidateA}::uuid
          AND source_reference=${claim.sourceReference}
      `;
      assert.equal(resumeEvidence[0]?.metadata?.skillKey, "postgresql");
      assert.equal(resumeEvidence[0]?.source_reference, claim.sourceReference);
      const declaredSkill = await database.sql`
        SELECT verification_state FROM candidate_skills
        WHERE organization_id=${orgA}::uuid AND candidate_id=${candidateA}::uuid
          AND skill_key='postgresql'
      `;
      assert.equal(declaredSkill[0]?.verification_state, "unverified");

      // A previously human-corrected mapping must remain in the immutable audit
      // history, but must not be exposed as a fresh claim after parser reprocessing.
      await database.sql`
        UPDATE resumes SET parser_version='outdated-before-reparse'
        WHERE organization_id=${orgA}::uuid AND id=${first.id}::uuid
      `;
      await tenant.run(orgA, () => service.ingest(candidateA, {
        originalName: "repeat-after-human-review.txt",
        mimeType: "text/plain",
        data: source,
      }));
      const reloaded = await tenant.run(orgA, () => intelligence.getWorkspace(candidateA));
      assert.equal(reloaded.resumeSkillClaims.some((item) => item.id === claim.id), false);
      assert.equal(reloaded.resumeSkillClaims.some((item) => item.skillKey === "postgresql"), true);
      const reviewedHistory = await tenant.run(orgA, () => skillEvidence.reviewHistory(candidateA, claim.id));
      assert.deepEqual(reviewedHistory.map((item) => item.reviewVersion), [1, 2]);
      const archived = await database.sql`
        SELECT review_state, is_current, evidence_id FROM resume_skill_claims
        WHERE organization_id=${orgA}::uuid AND id=${claim.id}::uuid
      `;
      assert.equal(archived[0]?.review_state, "confirmed");
      assert.equal(archived[0]?.is_current, false);
      assert.equal(archived[0]?.evidence_id, null);
      await assert.rejects(
        () => tenant.run(orgA, () => auth.run({
          userId: actorId, source: "session" as const,
        }, () => skillEvidence.reviewResumeClaim(candidateA, claim.id, {
          reviewState: "confirmed", reviewReason: "Stale claim is not active anymore", expectedVersion: 2,
        }))),
        /Resume skill claim not found/,
      );

      // Phase-1 acceptance: a second, different resume for the SAME candidate
      // keeps its own source claims across an independent parser-version replay.
      // Reusing identical bytes in a second tenant must create separate evidence.
      const otherSource = Buffer.from(
        "Maryam Rahimi\\nSkills\\nRedis, Docker\\nWork Experience\\n" +
        "Backend developer at Sample Co | 2021 - Present\\n" +
        "Built caching services using Redis and Docker in production environments.",
      );
      const second = await tenant.run(orgA, () => service.ingest(candidateA, {
        originalName: "second-career-resume.txt", mimeType: "text/plain", data: otherSource,
      }));
      const otherTenant = await tenant.run(orgB, () => service.ingest(candidateB, {
        originalName: "same-bytes-in-another-org.txt", mimeType: "text/plain", data: otherSource,
      }));
      assert.notEqual(second.id, first.id);
      assert.notEqual(otherTenant.id, second.id);
      const secondReplay = await tenant.run(orgA, () => service.ingest(candidateA, {
        originalName: "same-resume-renamed.txt", mimeType: "text/plain", data: otherSource,
      }));
      assert.equal(secondReplay.id, second.id);

      const selectClaims = async (org: string, resumeId: string) => database.sql`
        SELECT rc.id::text, rc.resume_id::text, rc.source_reference,
               rc.claim_text, rc.start_char, rc.end_char, rc.review_state,
               rc.review_version, rc.is_current, rc.evidence_id::text,
               st.skill_key, e.id::text AS joined_evidence_id
        FROM resume_skill_claims rc
        JOIN skill_taxonomy st ON st.organization_id=rc.organization_id AND st.id=rc.skill_id
        LEFT JOIN evidence e ON e.organization_id=rc.organization_id AND e.id=rc.evidence_id
        WHERE rc.organization_id=${org}::uuid AND rc.resume_id=${resumeId}::uuid
        ORDER BY st.skill_key, rc.id
      `;
      const secondClaims = await selectClaims(orgA, second.id);
      const crossTenantClaims = await selectClaims(orgB, otherTenant.id);
      assert.deepEqual(secondClaims.map((row) => row.skill_key), ["docker", "redis"]);
      assert.deepEqual(crossTenantClaims.map((row) => row.skill_key), ["docker", "redis"]);
      for (const row of secondClaims) {
        assert.equal(row.is_current, true);
        assert.equal(row.review_state, "pending");
        assert.equal(row.review_version, 0);
        assert.equal(row.evidence_id, row.joined_evidence_id);
        assert.equal(
          otherSource.toString("utf8").slice(Number(row.start_char), Number(row.end_char)),
          row.claim_text,
        );
        assert.match(String(row.source_reference), new RegExp(`^resume:${second.id}#skill:`));
      }
      for (const row of crossTenantClaims) {
        assert.equal(row.evidence_id, row.joined_evidence_id);
        assert.equal(row.is_current, true);
        assert.match(String(row.source_reference), new RegExp(`^resume:${otherTenant.id}#skill:`));
      }

      // Human-review history on the first resume must be immutable when the
      // second is reparsed using an earlier parser_version.
      const firstClaimsBefore = await selectClaims(orgA, first.id);
      await database.sql`
        UPDATE resumes SET parser_version='resume-structure-pre-v3'
        WHERE organization_id=${orgA}::uuid AND id=${second.id}::uuid
      `;
      const secondReprocessed = await tenant.run(orgA, () => service.ingest(candidateA, {
        originalName: "second-after-parser-upgrade.txt", mimeType: "text/plain", data: otherSource,
      }));
      assert.equal(secondReprocessed.id, second.id);
      const secondAfter = await selectClaims(orgA, second.id);
      assert.deepEqual(secondAfter.map((row) => row.id), secondClaims.map((row) => row.id));
      assert.equal(secondAfter.every((row) =>
        row.is_current === true && row.evidence_id === row.joined_evidence_id), true);
      assert.deepEqual(
        (await selectClaims(orgA, first.id)).map((row) => [
          row.id, row.review_version, row.is_current, row.source_reference,
        ]),
        firstClaimsBefore.map((row) => [
          row.id, row.review_version, row.is_current, row.source_reference,
        ]),
      );
      assert.deepEqual(
        (await selectClaims(orgB, otherTenant.id)).map((row) => [row.id, row.evidence_id]),
        crossTenantClaims.map((row) => [row.id, row.evidence_id]),
      );
      const orgAResumes = await tenant.run(orgA, () => service.listResumes(candidateA));
      const orgBResumes = await tenant.run(orgB, () => service.listResumes(candidateB));
      assert.deepEqual(new Set(orgAResumes.map((row) => row.id)), new Set([first.id, second.id]));
      assert.deepEqual(orgBResumes.map((row) => row.id), [otherTenant.id]);
      const crossTenantWorkspace = await tenant.run(orgB, () => intelligence.getWorkspace(candidateB));
      assert.deepEqual(crossTenantWorkspace.resumeSkillClaims.map((row) => row.resumeId).sort(),
        [otherTenant.id, otherTenant.id]);
      const ownWorkspace = await tenant.run(orgA, () => intelligence.getWorkspace(candidateA));
      assert.equal(ownWorkspace.resumeSkillClaims.some((row) =>
        row.resumeId === second.id && row.skillKey === "docker"), true);
      assert.equal(ownWorkspace.resumeSkillClaims.some((row) =>
        row.resumeId === otherTenant.id), false);
      assert.deepEqual((await tenant.run(orgA, () => skillEvidence.reviewHistory(candidateA, claim.id)))
        .map((row) => row.reviewVersion), [1, 2]);
      // Neither claim sources nor HR corrections can become verified competence.
      const scored = await database.sql`
        SELECT count(*)::int AS count FROM scorecards
        WHERE organization_id IN (${orgA}::uuid, ${orgB}::uuid)
      `;
      assert.equal(scored[0]?.count, 0);
      await assert.rejects(() => tenant.run(orgB, () => service.getResume(candidateB, second.id)),
        /Resume not found/);

      const removed = await tenant.run(orgA, () => skillEvidence.replaceJobSkills(jobId, []));
      assert.deepEqual(removed, []);
      const tombstones = await database.sql`
        SELECT requirement_version, is_active FROM job_skill_requirements
        WHERE organization_id=${orgA}::uuid AND job_id=${jobId}::uuid
        ORDER BY requirement_version ASC
      `;
      assert.deepEqual(tombstones.map((row) => [Number(row.requirement_version), row.is_active]), [
        [1, true], [2, true], [3, false],
      ]);

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
      assert.equal(resumeRows[0]?.count, 2);

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

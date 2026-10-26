import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { TenantContextService } from "../tenant/tenant-context.service";
import { AuthContextService } from "../auth/auth-context.service";
import type { DatabaseService } from "../database/database.service";
import type { SkillProposalProvider } from "./skill-proposal-provider";
import { SkillProposalsService } from "./skill-proposals.service";

const url = process.env.AUTH_INTEGRATION_DATABASE_URL;

test("opt-in proposals are source-bound, tenant isolated, idempotent and require human approval", {
  skip: !url,
}, async () => {
  const sql = postgres(url!, { max: 2, idle_timeout: 15, connect_timeout: 10 });
  const db = { sql, onModuleDestroy: async () => sql.end({ timeout: 5 }) } as DatabaseService;
  const tenant = new TenantContextService();
  const auth = new AuthContextService();
  const orgA = randomUUID(), orgB = randomUUID(), candidateId = randomUUID();
  const resumeId = randomUUID(), fileId = randomUUID(), reviewerId = randomUUID();
  const suffix = randomUUID();
  const text = "Skills: Redis caching and PostgreSQL database development in payment systems.\nExperience with Redis.";
  const sha = createHash("sha256").update(text).digest("hex");
  const start = text.indexOf("Redis");
  let providerCalls = 0;
  let invalid = false;
  const provider = {
    propose: async () => {
      providerCalls++;
      if (invalid) {
        return { status: "ok", provider: "fake", model: "test", output: { malicious: true } };
      }
      return { status: "ok", provider: "fake", model: "test",
        output: { schemaVersion: "skill-proposals.v1", proposals: [
          { skillKey: "redis", excerpt: "Redis", startChar: start, endChar: start + 5, confidence: 0.85 },
          { skillKey: "unknown", excerpt: "Redis", startChar: start, endChar: start + 5, confidence: 0.85 },
        ] } };
    },
  } as SkillProposalProvider;
  const service = new SkillProposalsService(db, tenant, auth, provider);

  try {
    await sql`
      INSERT INTO organizations(id, name, slug) VALUES
        (${orgA}::uuid,'Proposals Org A',${"proposals-a-"+suffix}),
        (${orgB}::uuid,'Proposals Org B',${"proposals-b-"+suffix})
    `;
    await sql`
      INSERT INTO users(id,email,display_name)
      VALUES(${reviewerId}::uuid,${"reviewer-"+suffix+"@example.invalid"},'Reviewer')
    `;
    await sql`INSERT INTO candidates(id,organization_id,display_name)
      VALUES(${candidateId}::uuid,${orgA}::uuid,'Candidate')`;
    await sql`
      INSERT INTO files(id,organization_id,storage_key,original_name,mime_type,size_bytes,sha256)
      VALUES(${fileId}::uuid,${orgA}::uuid,${"proposal/"+resumeId},'source.txt','text/plain',
        ${Buffer.byteLength(text)},${sha})
    `;
    await sql`
      INSERT INTO resumes(id,organization_id,candidate_id,file_id,original_filename,
        content_type,byte_size,sha256,status,parser_version)
      VALUES(${resumeId}::uuid,${orgA}::uuid,${candidateId}::uuid,${fileId}::uuid,
        'source.txt','text/plain',${Buffer.byteLength(text)},${sha},'completed','v3')
    `;
    await sql`
      INSERT INTO resume_documents(organization_id,resume_id,text_content,text_sha256,extractor_version)
      VALUES(${orgA}::uuid,${resumeId}::uuid,${text},${sha},'test')
    `;
    await sql`
      INSERT INTO skill_taxonomy(organization_id,skill_key,name_en,category)
      VALUES(${orgA}::uuid,'redis','Redis','technical')
    `;

    await assert.rejects(() => tenant.run(orgA, () => service.generate(candidateId, resumeId)),
      /authenticated user consent/i);
    await assert.rejects(() => tenant.run(orgB, () =>
      auth.run({ userId: reviewerId, source: "session" }, () => service.generate(candidateId, resumeId))),
    /not found/i);
    assert.equal(providerCalls, 0);

    const first = await tenant.run(orgA, () => auth.run({
      userId: reviewerId, source: "session",
    }, () => service.generate(candidateId, resumeId)));
    assert.equal(first.status, "ok");
    assert.equal(first.persistedCount, 1);
    assert.equal(first.proposals.length, 1);
    const proposal = first.proposals[0]!;
    assert.equal(proposal.skillKey, "redis");
    assert.equal(proposal.claimText, text.slice(proposal.startChar, proposal.endChar));
    assert.equal(proposal.reviewState, "pending");

    const duplicate = await tenant.run(orgA, () => auth.run({
      userId: reviewerId, source: "session",
    }, () => service.generate(candidateId, resumeId)));
    assert.equal(duplicate.persistedCount, 0);
    assert.equal(duplicate.proposals.length, 1);

    invalid = true;
    const fallback = await tenant.run(orgA, () => auth.run({
      userId: reviewerId, source: "session",
    }, () => service.generate(candidateId, resumeId)));
    assert.equal(fallback.status, "unavailable");
    assert.equal(fallback.persistedCount, 0);
    assert.equal(fallback.proposals.length, 1);
    invalid = false;

    await assert.rejects(() => tenant.run(orgB, () => auth.run({
      userId: reviewerId, source: "session",
    }, () => service.review(candidateId, resumeId, proposal.id, {
      decision: "approved", expectedVersion: 0, reason: "Cross tenant review attempt",
    }))), /not found/i);

    const approved = await tenant.run(orgA, () => auth.run({
      userId: reviewerId, source: "session",
    }, () => service.review(candidateId, resumeId, proposal.id, {
      decision: "approved", expectedVersion: 0,
      reason: "Verbatim evidence checked against resume document",
      reviewedAlias: "Redis",
    })));
    assert.equal(approved.reviewVersion, 1);
    assert.equal(approved.reviewState, "approved");
    await assert.rejects(() => tenant.run(orgA, () => auth.run({
      userId: reviewerId, source: "session",
    }, () => service.review(candidateId, resumeId, proposal.id, {
      decision: "rejected", expectedVersion: 0, reason: "Stale proposal approval",
    }))), /already reviewed/i);
    const aliases = await sql`SELECT alias_normalized FROM skill_aliases
      WHERE organization_id=${orgA}::uuid AND alias_normalized='redis'`;
    assert.equal(aliases.length, 1);
    const events = await sql`SELECT count(*)::int AS count FROM resume_skill_proposal_review_events
      WHERE organization_id=${orgA}::uuid AND proposal_id=${proposal.id}::uuid`;
    assert.equal(events[0]?.count, 1);

    // A different skill cannot acquire an alias already human-registered to Redis,
    // even though both canonical keys belong to the same tenant.
    await sql`
      INSERT INTO skill_taxonomy(organization_id,skill_key,name_en,category)
      VALUES(${orgA}::uuid,'postgresql','PostgreSQL','technical')
      ON CONFLICT (organization_id,skill_key) DO NOTHING
    `;
    const secondProposal = randomUUID();
    await sql`
      INSERT INTO resume_skill_proposals(
        id, organization_id, candidate_id, resume_id, skill_id, source_text_sha256,
        claim_text, start_char, end_char, extraction_confidence, provider, model
      )
      SELECT ${secondProposal}::uuid, ${orgA}::uuid, ${candidateId}::uuid, ${resumeId}::uuid,
             st.id, ${sha}, 'Redis', ${start}, ${start + 5}, 0.65, 'test', 'test'
      FROM skill_taxonomy st
      WHERE st.organization_id=${orgA}::uuid AND st.skill_key='postgresql'
    `;
    await assert.rejects(() => tenant.run(orgA, () => auth.run({
      userId: reviewerId, source: "session",
    }, () => service.review(candidateId, resumeId, secondProposal, {
      decision: "approved", expectedVersion: 0,
      reason: "Attempt to register conflicting taxonomy alias", reviewedAlias: "Redis",
    }))), /another canonical skill/i);
    const stillPending = await sql`
      SELECT review_state FROM resume_skill_proposals
      WHERE organization_id=${orgA}::uuid AND id=${secondProposal}::uuid
    `;
    assert.equal(stillPending[0]?.review_state, "pending");

    // A reprocessed/changed resume invalidates source-bound proposals.
    await sql`
      UPDATE resume_documents SET text_sha256=${"d".repeat(64)}
      WHERE organization_id=${orgA}::uuid AND resume_id=${resumeId}::uuid
    `;
    await assert.rejects(() => tenant.run(orgA, () => auth.run({
      userId: reviewerId, source: "session",
    }, () => service.review(candidateId, resumeId, secondProposal, {
      decision: "rejected", expectedVersion: 0, reason: "Source version should not match",
    }))), /source changed/i);
    assert.deepEqual(await tenant.run(orgA, () => service.list(candidateId, resumeId)), [],
      "stale suggestions must remain auditable but not appear as current resume proposals");
    const immutableArchivedProposal = await sql`
      SELECT review_state, source_text_sha256 FROM resume_skill_proposals
      WHERE organization_id=${orgA}::uuid AND id=${proposal.id}::uuid
    `;
    assert.equal(immutableArchivedProposal[0]?.review_state, "approved");
    assert.equal(immutableArchivedProposal[0]?.source_text_sha256, sha);
    // Human approval is still NOT verification and never changes candidate scores.
    const verified = await sql`SELECT count(*)::int AS count FROM candidate_skills
      WHERE organization_id=${orgA}::uuid AND candidate_id=${candidateId}::uuid AND verification_state='verified'`;
    assert.equal(verified[0]?.count, 0);
    const actual = await sql`SELECT count(*)::int AS count FROM candidate_criterion_evaluations
      WHERE organization_id=${orgA}::uuid`;
    assert.equal(actual[0]?.count, 0);
  } finally {
    await sql`DELETE FROM organizations WHERE id IN (${orgA}::uuid,${orgB}::uuid)`;
    await sql`DELETE FROM users WHERE id=${reviewerId}::uuid`;
    await db.onModuleDestroy();
  }
});

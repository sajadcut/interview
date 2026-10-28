import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import type { AuthContextService } from "../auth/auth-context.service";
import type { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import { SkillEvidenceService } from "./skill-evidence.service";

const url = process.env.AUTH_INTEGRATION_DATABASE_URL;

test("skill requirements are tenant-scoped, append-only versions and claim review is auditable", { skip: !url }, async () => {
  const sql = postgres(url!, { max: 3, idle_timeout: 20, connect_timeout: 10 });
  const database = { sql, onModuleDestroy: () => sql.end({ timeout: 5 }) } as DatabaseService;
  const tenant = new TenantContextService();
  const actor = randomUUID();
  const auth = { getOptional: () => ({ userId: actor }) } as unknown as AuthContextService;
  const skills = new SkillEvidenceService(database, tenant, auth);
  const orgA = randomUUID(), orgB = randomUUID(), candidateA = randomUUID(), candidateNew = randomUUID();
  const jobA = randomUUID(), jobB = randomUUID(), fileId = randomUUID(), resumeId = randomUUID();
  const appA = randomUUID(), appA2 = randomUUID(), appB = randomUUID();
  const rubricA = randomUUID(), rubricB = randomUUID();
  const rubricA1 = randomUUID(), rubricA2 = randomUUID(), rubricB1 = randomUUID();
  const otherJobCriterion = randomUUID();
  const claimId = randomUUID(), evidenceId = randomUUID(), suffix = randomUUID();

  const redis = {
    skillKey: "redis", nameEn: "Redis", nameFa: "ردیس", category: "technical" as const,
    requiredLevel: 3, weight: 1, required: true, minimumEvidenceCount: 2,
  };
  try {
    await sql`INSERT INTO organizations(id,name,slug) VALUES
      (${orgA}::uuid,'Skills Org A',${"skills-a-"+suffix}),
      (${orgB}::uuid,'Skills Org B',${"skills-b-"+suffix})`;
    await sql`INSERT INTO users(id,email) VALUES (${actor}::uuid,${"reviewer-"+suffix+"@example.invalid"})`;
    await sql`INSERT INTO candidates(id,organization_id,display_name)
      VALUES (${candidateA}::uuid,${orgA}::uuid,'Skill Candidate')`;
    await sql`INSERT INTO jobs(id,organization_id,title) VALUES
      (${jobA}::uuid,${orgA}::uuid,'Redis Engineer')`;

    const initial = await tenant.run(orgA, () => skills.replaceJobSkills(jobA, [redis]));
    assert.equal(initial.length, 1);
    assert.equal(initial[0]?.requirementVersion, 1);
    const replay = await tenant.run(orgA, () => skills.replaceJobSkills(jobA, [redis]));
    assert.equal(replay[0]?.requirementVersion, 1);
    const changed = await tenant.run(orgA, () => skills.replaceJobSkills(jobA, [
      { ...redis, requiredLevel: 4 },
    ]));
    assert.equal(changed[0]?.requirementVersion, 2);

    await assert.rejects(
      () => tenant.run(orgB, () => skills.listJobSkills(jobA)),
      /Job not found/,
    );
    await assert.rejects(
      () => tenant.run(orgB, () => skills.replaceJobSkills(jobA, [redis])),
      /Job not found/,
    );
    await assert.rejects(
      () => tenant.run(orgA, () => skills.replaceJobSkills(jobA, [redis, redis])),
      /Duplicate skill key/,
    );

    await sql`INSERT INTO files(id,organization_id,storage_key,original_name,mime_type,size_bytes,sha256)
      VALUES (${fileId}::uuid,${orgA}::uuid,${"resume/"+resumeId},'test.txt','text/plain',5,${"c".repeat(64)})`;
    await sql`INSERT INTO resumes(id,organization_id,candidate_id,file_id,
        original_filename,content_type,byte_size,sha256,status)
      VALUES(${resumeId}::uuid,${orgA}::uuid,${candidateA}::uuid,${fileId}::uuid,
        'test.txt','text/plain',5,${"c".repeat(64)},'completed')`;
    const sourceReference = "resume:"+resumeId+"#skill:redis";
    await sql`INSERT INTO evidence(id,organization_id,candidate_id,evidence_type,
        source_type,source_reference,excerpt)
      VALUES(${evidenceId}::uuid,${orgA}::uuid,${candidateA}::uuid,
        'resume_claim','resume',${sourceReference},'Redis')`;
    await sql`INSERT INTO resume_skill_claims(id,organization_id,candidate_id,
        resume_id,skill_id,evidence_id,source_reference,claim_text,start_char,end_char,
        extraction_confidence,taxonomy_version,parser_version)
      SELECT ${claimId}::uuid,${orgA}::uuid,${candidateA}::uuid,${resumeId}::uuid,
        st.id,${evidenceId}::uuid,${sourceReference},'Redis',0,5,0.95,'v1','test'
      FROM skill_taxonomy st WHERE st.organization_id=${orgA}::uuid AND st.skill_key='redis'`;

    const confirmed = await tenant.run(orgA, () => skills.reviewResumeClaim(candidateA, claimId, {
      reviewState: "confirmed", reviewReason: "مطابقت متن ادعا با رزومه بررسی شد", expectedVersion: 0,
    }));
    assert.equal(confirmed.reviewState, "confirmed");
    assert.equal(confirmed.reviewerUserId, actor);
    await assert.rejects(() => tenant.run(orgA, () => skills.reviewResumeClaim(candidateA, claimId, {
      reviewState: "confirmed", reviewReason: "مطابقت متن ادعا با رزومه بررسی شد", expectedVersion: 0,
    })), /Stale resume skill claim review version/);
    const events = await sql`SELECT count(*)::int AS count FROM resume_skill_claim_review_events
      WHERE organization_id=${orgA}::uuid AND claim_id=${claimId}::uuid`;
    assert.equal(events[0]?.count, 1);

    await assert.rejects(
      () => tenant.run(orgB, () => skills.reviewResumeClaim(candidateA, claimId, {
        reviewState: "rejected", reviewReason: "No source matches the skill assertion", expectedVersion: 1,
      })),
      /Resume skill claim not found/,
    );

    const claims = await sql`SELECT review_state, review_reason FROM resume_skill_claims
      WHERE organization_id=${orgA}::uuid AND id=${claimId}::uuid`;
    assert.equal(claims[0]?.review_state, "confirmed");
    // HR review of assertion presence is deliberately not a technical competence score.
    const evaluations = await sql`SELECT count(*)::int AS count FROM candidate_criterion_evaluations
      WHERE organization_id=${orgA}::uuid`;
    assert.equal(evaluations[0]?.count, 0);

    // A candidate is organization-global, but applications and pinned rubrics
    // are job-specific. Revisions in one job may not rewrite another job.
    await sql`INSERT INTO jobs(id,organization_id,title) VALUES
      (${jobB}::uuid,${orgA}::uuid,'Redis Operator')`;
    await sql`INSERT INTO rubrics(id,organization_id,job_id,name,status) VALUES
      (${rubricA}::uuid,${orgA}::uuid,${jobA}::uuid,'Engineering Rubric','published'),
      (${rubricB}::uuid,${orgA}::uuid,${jobB}::uuid,'Operations Rubric','published')`;
    await sql`INSERT INTO rubric_versions(id,organization_id,rubric_id,version,status,published_at)
      VALUES
      (${rubricA1}::uuid,${orgA}::uuid,${rubricA}::uuid,1,'published',now()),
      (${rubricB1}::uuid,${orgA}::uuid,${rubricB}::uuid,1,'published',now())`;
    await sql`INSERT INTO rubric_criteria(
      id,organization_id,rubric_version_id,criterion_key,label,weight,required,display_order
    ) VALUES (${otherJobCriterion}::uuid,${orgA}::uuid,${rubricB1}::uuid,
      'redis_operations','Redis operations',1,true,0)`;
    await sql`INSERT INTO applications(id,organization_id,job_id,candidate_id) VALUES
      (${appA}::uuid,${orgA}::uuid,${jobA}::uuid,${candidateA}::uuid),
      (${appB}::uuid,${orgA}::uuid,${jobB}::uuid,${candidateA}::uuid)`;

    const jobBSkills = await tenant.run(orgA, () => skills.replaceJobSkills(jobB, [
      { ...redis, requiredLevel: 2, minimumEvidenceCount: 1 },
    ]));
    assert.equal(jobBSkills[0]?.requirementVersion, 1);
    assert.equal(jobBSkills[0]?.requiredLevel, 2);
    await assert.rejects(() => tenant.run(orgA, () => skills.replaceJobSkills(jobA, [
      { ...redis, requiredLevel: 5, rubricCriterionId: otherJobCriterion },
    ])), /another job/i);
    const afterConflict = await tenant.run(orgA, () => skills.listJobSkills(jobA));
    assert.equal(afterConflict[0]?.requiredLevel, 4);
    assert.equal(afterConflict[0]?.requirementVersion, 2);

    await sql`INSERT INTO rubric_versions(id,organization_id,rubric_id,version,status,published_at)
      VALUES (${rubricA2}::uuid,${orgA}::uuid,${rubricA}::uuid,2,'published',now())`;
    // One application per candidate/job is unique; use a second candidate
    // to prove newly published rubric versions affect only future applications.
    await sql`INSERT INTO candidates(id,organization_id,display_name)
      VALUES (${candidateNew}::uuid,${orgA}::uuid,'Later Skill Candidate')`;
    await sql`INSERT INTO applications(id,organization_id,job_id,candidate_id)
      VALUES (${appA2}::uuid,${orgA}::uuid,${jobA}::uuid,${candidateNew}::uuid)`;
    const pins=await sql`
      SELECT id::text,rubric_version_id::text FROM applications
      WHERE organization_id=${orgA}::uuid AND id IN (
        ${appA}::uuid,${appA2}::uuid,${appB}::uuid
      )
    `;
    const pinById=new Map(pins.map(row=>[String(row.id),String(row.rubric_version_id)]));
    assert.equal(pinById.get(appA),rubricA1);
    assert.equal(pinById.get(appA2),rubricA2);
    assert.equal(pinById.get(appB),rubricB1);
    const reviewedClaim=await sql`SELECT review_state,review_version
      FROM resume_skill_claims WHERE organization_id=${orgA}::uuid AND id=${claimId}::uuid`;
    assert.equal(reviewedClaim[0]?.review_state,"confirmed");
    assert.equal(Number(reviewedClaim[0]?.review_version),1);
    assert.equal((await sql`SELECT count(*)::int AS count FROM candidate_criterion_evaluations
      WHERE organization_id=${orgA}::uuid`)[0]?.count,0);

    const active = await tenant.run(orgA, () => skills.replaceJobSkills(jobA, []));
    assert.equal(active.length, 0);
    const revisions = await sql`SELECT requirement_version, is_active FROM job_skill_requirements
      WHERE organization_id=${orgA}::uuid AND job_id=${jobA}::uuid
      ORDER BY requirement_version`;
    assert.deepEqual(revisions.map((row) => [row.requirement_version, row.is_active]),
      [[1, true], [2, true], [3, false]]);
  } finally {
    await sql`DELETE FROM organizations WHERE id IN (${orgA}::uuid,${orgB}::uuid)`;
    await sql`DELETE FROM users WHERE id=${actor}::uuid`;
    await database.onModuleDestroy();
  }
});

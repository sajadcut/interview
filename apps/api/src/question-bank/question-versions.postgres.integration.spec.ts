import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import type { DatabaseService } from "../database/database.service";
import type { AuthContextService } from "../auth/auth-context.service";
import type { StorageService } from "../storage/storage.service";
import type { ResumeTextExtractor } from "../resumes/resume-text-extractor";
import { TenantContextService } from "../tenant/tenant-context.service";
import { QuestionBankService } from "./question-bank.service";
import { QuestionVersionsService } from "./question-versions.service";

const url=process.env.AUTH_INTEGRATION_DATABASE_URL;

test("versioned bank questions are source-scoped, reviewed and frozen per application",
  {skip:!url},async()=>{
    const sql=postgres(url!,{max:3,idle_timeout:20,connect_timeout:10});
    const db={sql,onModuleDestroy:()=>sql.end({timeout:5})} as DatabaseService;
    const tenant=new TenantContextService();
    const actor=randomUUID(),orgA=randomUUID(),orgB=randomUUID(),jobId=randomUUID();
    const candidateId=randomUUID(),applicationId=randomUUID(),fileId=randomUUID(),documentId=randomUUID();
    const rubricId=randomUUID(),rubricVersionId=randomUUID(),criterionId=randomUUID();
    const releaseUnitId=randomUUID(),planId=randomUUID(),sessionId=randomUUID();
    const laterRubricVersionId=randomUUID(),laterPlanId=randomUUID();
    const suffix=randomUUID();
    const source="Technical interview reference: How would you design idempotency for a .NET payment API? " +
      "Explain handling retries, conflict errors and durable state in SQL Server.";
    const question="How would you design idempotency for a .NET payment API?";
    const revised="How would you defend idempotency under concurrent payment retries?";
    const hash=createHash("sha256").update(source).digest("hex");
    const auth={getOptional:()=>({userId:actor})} as unknown as AuthContextService;
    const bank=new QuestionBankService(db,tenant,{} as StorageService,{} as ResumeTextExtractor);
    const service=new QuestionVersionsService(db,tenant,auth);
    try{
      await sql`INSERT INTO organizations(id,name,slug) VALUES
        (${orgA}::uuid,'Question Org A',${"question-a-"+suffix}),
        (${orgB}::uuid,'Question Org B',${"question-b-"+suffix})`;
      await sql`INSERT INTO users(id,email) VALUES
        (${actor}::uuid,${"question-reviewer-"+suffix+"@example.invalid"})`;
      await sql`INSERT INTO candidates(id,organization_id,display_name)
        VALUES(${candidateId}::uuid,${orgA}::uuid,'Question Candidate')`;
      await sql`INSERT INTO jobs(id,organization_id,title,status)
        VALUES(${jobId}::uuid,${orgA}::uuid,'Senior .NET Engineer','active')`;
      await sql`INSERT INTO rubrics(id,organization_id,job_id,name,status)
        VALUES(${rubricId}::uuid,${orgA}::uuid,${jobId}::uuid,'Question Rubric','published')`;
      await sql`INSERT INTO rubric_versions(id,organization_id,rubric_id,version,status,published_at)
        VALUES(${rubricVersionId}::uuid,${orgA}::uuid,${rubricId}::uuid,1,'published',now())`;
      await sql`INSERT INTO rubric_criteria(
        id,organization_id,rubric_version_id,criterion_key,label,weight,required,display_order
      ) VALUES (${criterionId}::uuid,${orgA}::uuid,${rubricVersionId}::uuid,
        'idempotency','Payment idempotency',1,true,0)`;
      await sql`INSERT INTO applications(id,organization_id,job_id,candidate_id)
        VALUES(${applicationId}::uuid,${orgA}::uuid,${jobId}::uuid,${candidateId}::uuid)`;
      await sql`INSERT INTO files(id,organization_id,storage_key,original_name,mime_type,size_bytes,sha256)
        VALUES(${fileId}::uuid,${orgA}::uuid,${"question/"+documentId},'bank.txt',
          'text/plain',${Buffer.byteLength(source)},${hash})`;
      await sql`INSERT INTO question_bank_documents(
          id,organization_id,job_id,file_id,original_name,mime_type,byte_size,sha256,extracted_text
        ) VALUES (${documentId}::uuid,${orgA}::uuid,${jobId}::uuid,${fileId}::uuid,
          'bank.txt','text/plain',${Buffer.byteLength(source)},${hash},${source})`;
      await sql`INSERT INTO skill_taxonomy(organization_id,skill_key,name_en,category)
        VALUES(${orgA}::uuid,'dotnet','.NET','technical')`;

      await assert.rejects(()=>tenant.run(orgB,()=>service.create(jobId,{
        documentId,questionText:question,sourceExcerpt:question,skillKey:"dotnet"
      })),/not found/i);
      await assert.rejects(()=>tenant.run(orgA,()=>service.create(jobId,{
        documentId,questionText:question,sourceExcerpt:"Made-up source excerpt that did not exist",
        skillKey:"dotnet"
      })),/must occur literally/i);
      const added=await tenant.run(orgA,()=>service.create(jobId,{
        documentId,questionText:question,sourceExcerpt:question,skillKey:"dotnet"
      }));
      assert.equal(added.length,1);
      const first=added[0]!;
      assert.equal(first.reviewState,"pending");
      assert.equal(first.version,1);
      assert.equal(first.skillKey,"dotnet");
      assert.equal(first.documentId,documentId);
      await assert.rejects(()=>tenant.run(orgB,()=>service.list(jobId)),/Job not found/);

      const initialSnapshot=await tenant.run(orgA,()=>bank.saveSelection(applicationId,[documentId]));
      assert.equal(initialSnapshot.snapshotVersion,1);
      const before=await tenant.run(orgA,()=>bank.selectionSnapshots(applicationId));
      assert.equal(before.length,1);
      assert.deepEqual(before[0]?.approvedQuestionVersions,[]);
      await assert.rejects(()=>tenant.run(orgA,()=>service.review(jobId,first.id,{
        decision:"approved",expectedVersion:2,reason:"Stale question version requested"
      })),/changed or already reviewed/);

      // A canonical taxonomy entry alone does not authorize using a question in
      // an interview for this particular job.
      await assert.rejects(()=>tenant.run(orgA,()=>service.review(jobId,first.id,{
        decision:"approved",expectedVersion:1,
        reason:"Must not approve a question outside job skill requirements"
      })),/active job skill requirement/i);
      await sql`INSERT INTO job_skill_requirements(
        organization_id,job_id,skill_id,required_level,weight,required,minimum_evidence_count
      ) SELECT ${orgA}::uuid,${jobId}::uuid,id,3,1,true,1 FROM skill_taxonomy
        WHERE organization_id=${orgA}::uuid AND skill_key='dotnet'`;
      const approved=await tenant.run(orgA,()=>service.review(jobId,first.id,{
        decision:"approved",expectedVersion:1,
        reason:"Reviewed against job skill taxonomy and source excerpt"
      }));
      assert.equal(approved.decision,"approved");
      await assert.rejects(()=>tenant.run(orgA,()=>service.review(jobId,first.id,{
        decision:"rejected",expectedVersion:1,reason:"Attempt to overwrite review"
      })),/changed or already reviewed/);
      await tenant.run(orgA,()=>bank.saveSelection(applicationId,[documentId]));
      const withApproved=await tenant.run(orgA,()=>bank.selectionSnapshots(applicationId));
      assert.equal(withApproved.length,2);
      assert.equal(withApproved[0]?.snapshotVersion,2);
      const items=withApproved[0]?.approvedQuestionVersions as Array<Record<string,unknown>>;
      assert.equal(items.length,1);
      assert.equal(items[0]?.versionId,first.versionId);
      assert.equal(items[0]?.skillKey,"dotnet");
      assert.equal(items[0]?.documentSha256,hash);
      assert.deepEqual(withApproved[1]?.approvedQuestionVersions,[]);
      assert.notEqual(withApproved[0]?.contentSha256,withApproved[1]?.contentSha256);

      await assert.rejects(()=>tenant.run(orgA,()=>service.revise(jobId,first.id,{
        expectedVersion:0,questionText:revised,sourceExcerpt:question,skillKey:"dotnet"
      })),/version changed/i);
      const later=await tenant.run(orgA,()=>service.revise(jobId,first.id,{
        expectedVersion:1,questionText:revised,sourceExcerpt:question,skillKey:"dotnet"
      }));
      assert.equal(later[0]?.version,2);
      assert.equal(later[0]?.reviewState,"pending");
      await tenant.run(orgA,()=>bank.saveSelection(applicationId,[documentId]));
      const afterRevision=await tenant.run(orgA,()=>bank.selectionSnapshots(applicationId));
      assert.equal(afterRevision[0]?.snapshotVersion,3);
      assert.deepEqual(afterRevision[0]?.approvedQuestionVersions,[]);
      assert.equal((afterRevision[1]?.approvedQuestionVersions as unknown[]).length,1);
      assert.equal((afterRevision[2]?.approvedQuestionVersions as unknown[]).length,0);
      // Even direct SQL cannot silently rewrite an older approved version or frozen snapshot.
      await assert.rejects(()=>sql`UPDATE question_bank_question_versions SET question_text='tampered'
        WHERE organization_id=${orgA}::uuid AND id=${first.versionId}::uuid`,/immutable/i);
      await assert.rejects(()=>sql`DELETE FROM application_question_selection_snapshots
        WHERE organization_id=${orgA}::uuid AND application_id=${applicationId}::uuid`,/immutable/i);
      // The database pins latest exact selection when a real session is admitted.
      // This covers all session creation paths, not only the public API.
      await sql`INSERT INTO interview_release_units (
        id,organization_id,job_family,language,interview_type,rubric_version_family,
        interviewer_policy_version,speech_avatar_stack_version,evaluator_version,lifecycle_stage
      ) VALUES (${releaseUnitId}::uuid,${orgA}::uuid,'question-bank-fixture','en','structured',
        'question-rubric-v1','policy-v1','speech-v1','evaluator-v1','INTERNAL_TEST')`;
      await sql`INSERT INTO interview_plans(
        id,organization_id,job_id,rubric_version_id,release_unit_id,
        version,status,language,interview_type,time_budget_minutes
      ) VALUES (${planId}::uuid,${orgA}::uuid,${jobId}::uuid,${rubricVersionId}::uuid,
        ${releaseUnitId}::uuid,1,'published','en','structured',30)`;
      // Publishing a new rubric must not silently change the application pin.
      await sql`INSERT INTO rubric_versions(id,organization_id,rubric_id,version,status,published_at)
        VALUES (${laterRubricVersionId}::uuid,${orgA}::uuid,${rubricId}::uuid,2,'published',now())`;
      await sql`INSERT INTO interview_plans(
        id,organization_id,job_id,rubric_version_id,release_unit_id,
        version,status,language,interview_type,time_budget_minutes
      ) VALUES (${laterPlanId}::uuid,${orgA}::uuid,${jobId}::uuid,${laterRubricVersionId}::uuid,
        ${releaseUnitId}::uuid,2,'published','en','structured',30)`;
      await assert.rejects(() => sql`
        INSERT INTO interview_sessions(organization_id,application_id,interview_plan_id,status)
        VALUES (${orgA}::uuid,${applicationId}::uuid,${laterPlanId}::uuid,'invited')
      `, /application pinned job and rubric version/i);
      const pinnedRubric=await sql`
        SELECT rubric_version_id::text FROM applications
        WHERE organization_id=${orgA}::uuid AND id=${applicationId}::uuid
      `;
      assert.equal(pinnedRubric[0]?.rubric_version_id,rubricVersionId);
      await sql`INSERT INTO interview_sessions(
        id,organization_id,application_id,interview_plan_id,status,remaining_seconds
      ) VALUES (${sessionId}::uuid,${orgA}::uuid,${applicationId}::uuid,
        ${planId}::uuid,'invited',1800)`;
      const pinned=await sql`
        SELECT s.question_selection_snapshot_id::text AS snapshot_id,
               qs.snapshot_version,qs.content_sha256,qs.approved_question_versions
        FROM interview_sessions s
        JOIN application_question_selection_snapshots qs
          ON qs.organization_id=s.organization_id AND qs.application_id=s.application_id
         AND qs.id=s.question_selection_snapshot_id
        WHERE s.organization_id=${orgA}::uuid AND s.id=${sessionId}::uuid
      `;
      assert.equal(Number(pinned[0]?.snapshot_version),3);
      assert.equal(pinned[0]?.content_sha256,afterRevision[0]?.contentSha256);
      assert.deepEqual(pinned[0]?.approved_question_versions,[]);
      await assert.rejects(()=>sql`
        UPDATE interview_sessions SET question_selection_snapshot_id=NULL
        WHERE organization_id=${orgA}::uuid AND id=${sessionId}::uuid
      `,/cannot be rebound/i);
      await assert.rejects(()=>tenant.run(orgA,()=>bank.saveSelection(applicationId,[documentId])),
        /locked after interview starts/i);
      const pinnedAfter=await sql`
        SELECT question_selection_snapshot_id::text AS snapshot_id
        FROM interview_sessions WHERE organization_id=${orgA}::uuid AND id=${sessionId}::uuid
      `;
      assert.equal(pinnedAfter[0]?.snapshot_id,pinned[0]?.snapshot_id);

      const count=await sql`SELECT count(*)::int AS count FROM scorecards
        WHERE organization_id=${orgA}::uuid`;
      assert.equal(count[0]?.count,0);
    }finally{
      // Existing file attachments have RESTRICT FKs. Clean the application and
      // job-bound document first; cascading source deletion then clears nested
      // immutable question versions and snapshots without editing them in place.
      await sql`DELETE FROM applications WHERE organization_id=${orgA}::uuid AND id=${applicationId}::uuid`;
      await sql`DELETE FROM question_bank_documents
        WHERE organization_id=${orgA}::uuid AND id=${documentId}::uuid`;
      await sql`DELETE FROM files WHERE organization_id=${orgA}::uuid AND id=${fileId}::uuid`;
      await sql`DELETE FROM organizations WHERE id IN (${orgA}::uuid,${orgB}::uuid)`;
      await sql`DELETE FROM users WHERE id=${actor}::uuid`;
      await db.onModuleDestroy();
    }
  });

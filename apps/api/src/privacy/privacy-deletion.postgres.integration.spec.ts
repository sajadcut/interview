import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import type { DatabaseService } from "../database/database.service";
import type { StorageProvider } from "../storage/storage-provider";
import { PrivacyDeletionLegalHoldService } from "./privacy-deletion-legal-hold.service";
import { PrivacyDeletionQueueService } from "./privacy-deletion-queue.service";

const integrationDatabaseUrl = process.env.AUTH_INTEGRATION_DATABASE_URL;

function createIntegrationDatabase(): DatabaseService {
  if (!integrationDatabaseUrl) {
    throw new Error("AUTH_INTEGRATION_DATABASE_URL is required for PostgreSQL integration tests");
  }
  const sql = postgres(integrationDatabaseUrl, { max: 1, idle_timeout: 20, connect_timeout: 10 });
  return {
    sql,
    onModuleDestroy: async () => {
      await sql.end({ timeout: 5 });
    },
  } as DatabaseService;
}

function createMemoryStorage(keys: string[]) {
  const objects = new Set(keys);
  const deleted: string[] = [];
  const storage: StorageProvider = {
    async put(key, data) {
      objects.add(key);
      return { key, sizeBytes: data.byteLength };
    },
    async get(key) {
      if (!objects.has(key)) throw new Error("missing object");
      return new Uint8Array([1]);
    },
    async delete(key) {
      deleted.push(key);
      objects.delete(key);
    },
    async exists(key) {
      return objects.has(key);
    },
    async createReadReference(key) {
      return `memory://${key}`;
    },
  };
  return { storage, objects, deleted };
}

test(
  "privacy worker deletes candidate content, derived data and external objects while preserving proof; canonical legal holds block erasure",
  { skip: !integrationDatabaseUrl },
  async () => {
    const database = createIntegrationDatabase();
    const organizationId = randomUUID();
    const reviewerId = randomUUID();
    const jobId = randomUUID();
    const rubricId = randomUUID();
    const rubricVersionId = randomUUID();
    const releaseUnitId = randomUUID();
    const planId = randomUUID();
    const candidateId = randomUUID();
    const applicationId = randomUUID();
    const resumeFileId = randomUUID();
    const recordingFileId = randomUUID();
    const assessmentFileId = randomUUID();
    const resumeId = randomUUID();
    const chunkId = randomUUID();
    const interviewSessionId = randomUUID();
    const assessmentId = randomUUID();
    const assessmentSessionId = randomUUID();
    const submissionId = randomUUID();
    const sourcingRunId = randomUUID();
    const privacyRequestId = randomUUID();
    const automationRuleId = randomUUID();
    const integrationId = randomUUID();
    const aiExecutionId = randomUUID();
    const resumeKey = `privacy/${candidateId}/resume.pdf`;
    const recordingKey = `privacy/${candidateId}/recording.webm`;
    const assessmentKey = `privacy/${candidateId}/assessment.txt`;
    const memory = createMemoryStorage([resumeKey, recordingKey, assessmentKey]);
    const queue = new PrivacyDeletionQueueService(database, memory.storage);
    const legalHoldGate = new PrivacyDeletionLegalHoldService(database);

    try {
      await database.sql`
        INSERT INTO organizations (id, name, slug)
        VALUES (${organizationId}::uuid, 'Privacy Integration', ${`privacy-${organizationId}`})
      `;
      await database.sql`
        INSERT INTO users (id, email, display_name)
        VALUES (${reviewerId}::uuid, ${`privacy-${reviewerId}@example.test`}, 'Privacy Reviewer')
      `;
      await database.sql`
        INSERT INTO jobs (id, organization_id, title, status)
        VALUES (${jobId}::uuid, ${organizationId}::uuid, 'Privacy Test Job', 'active')
      `;
      await database.sql`
        INSERT INTO rubrics (id, organization_id, job_id, name, status)
        VALUES (${rubricId}::uuid, ${organizationId}::uuid, ${jobId}::uuid, 'Privacy Rubric', 'published')
      `;
      await database.sql`
        INSERT INTO rubric_versions (id, organization_id, rubric_id, version, status)
        VALUES (${rubricVersionId}::uuid, ${organizationId}::uuid, ${rubricId}::uuid, 1, 'published')
      `;
      await database.sql`
        INSERT INTO interview_release_units (
          id, organization_id, job_family, language, interview_type, rubric_version_family,
          interviewer_policy_version, speech_avatar_stack_version, evaluator_version
        ) VALUES (
          ${releaseUnitId}::uuid, ${organizationId}::uuid, 'engineering', 'en', 'technical', 'privacy-v1',
          'policy-v1', 'speech-v1', 'evaluator-v1'
        )
      `;
      await database.sql`
        INSERT INTO interview_plans (
          id, organization_id, job_id, rubric_version_id, release_unit_id, version,
          status, language, interview_type, time_budget_minutes
        ) VALUES (
          ${planId}::uuid, ${organizationId}::uuid, ${jobId}::uuid, ${rubricVersionId}::uuid,
          ${releaseUnitId}::uuid, 1, 'published', 'en', 'technical', 30
        )
      `;
      await database.sql`
        INSERT INTO candidates (id, organization_id, display_name, primary_email)
        VALUES (${candidateId}::uuid, ${organizationId}::uuid, 'Delete Me', 'delete-me@example.test')
      `;
      await database.sql`
        INSERT INTO applications (id, organization_id, job_id, candidate_id, status, pipeline_stage)
        VALUES (${applicationId}::uuid, ${organizationId}::uuid, ${jobId}::uuid, ${candidateId}::uuid, 'active', 'interview')
      `;
      for (const [fileId, key, name, mime] of [
        [resumeFileId, resumeKey, 'resume.pdf', 'application/pdf'],
        [recordingFileId, recordingKey, 'recording.webm', 'video/webm'],
        [assessmentFileId, assessmentKey, 'assessment.txt', 'text/plain'],
      ] as const) {
        await database.sql`
          INSERT INTO files (id, organization_id, storage_key, original_name, mime_type, size_bytes, sha256)
          VALUES (${fileId}::uuid, ${organizationId}::uuid, ${key}, ${name}, ${mime}, 10, ${"a".repeat(64)})
        `;
      }
      await database.sql`
        INSERT INTO resumes (
          id, organization_id, candidate_id, application_id, file_id, status,
          original_filename, content_type, byte_size, sha256
        ) VALUES (
          ${resumeId}::uuid, ${organizationId}::uuid, ${candidateId}::uuid, ${applicationId}::uuid,
          ${resumeFileId}::uuid, 'completed', 'resume.pdf', 'application/pdf', 10, ${"b".repeat(64)}
        )
      `;
      await database.sql`
        INSERT INTO resume_documents (organization_id, resume_id, text_content, text_sha256, extractor_version)
        VALUES (${organizationId}::uuid, ${resumeId}::uuid, 'candidate resume text', ${"c".repeat(64)}, 'test-v1')
      `;
      await database.sql`
        INSERT INTO resume_chunks (
          id, organization_id, resume_id, chunk_index, text_content, content_hash, start_char, end_char, embedding_state
        ) VALUES (
          ${chunkId}::uuid, ${organizationId}::uuid, ${resumeId}::uuid, 0, 'candidate resume text', ${"d".repeat(64)}, 0, 21, 'completed'
        )
      `;
      await database.sql`
        INSERT INTO resume_chunk_embeddings (
          organization_id, resume_id, chunk_id, provider, model, dimensions, embedding, vector_sha256
        ) VALUES (
          ${organizationId}::uuid, ${resumeId}::uuid, ${chunkId}::uuid,
          'test', 'embedding-v1', 1, ${database.sql.json([0.5] as never)}, ${"e".repeat(64)}
        )
      `;
      await database.sql`
        INSERT INTO evidence (
          organization_id, candidate_id, application_id, evidence_type, source_type, source_reference, excerpt
        ) VALUES (
          ${organizationId}::uuid, ${candidateId}::uuid, ${applicationId}::uuid,
          'resume_claim', 'resume', ${`resume:${resumeId}`}, 'candidate evidence'
        )
      `;
      await database.sql`
        INSERT INTO interview_sessions (id, organization_id, application_id, interview_plan_id, status)
        VALUES (${interviewSessionId}::uuid, ${organizationId}::uuid, ${applicationId}::uuid, ${planId}::uuid, 'completed')
      `;
      await database.sql`
        INSERT INTO interview_transcript_segments (
          organization_id, interview_session_id, speaker, start_ms, end_ms, text, is_final
        ) VALUES (
          ${organizationId}::uuid, ${interviewSessionId}::uuid, 'candidate', 0, 1000, 'private transcript', true
        )
      `;
      await database.sql`
        INSERT INTO interview_evidence (organization_id, interview_session_id, summary)
        VALUES (${organizationId}::uuid, ${interviewSessionId}::uuid, 'derived interview evidence')
      `;
      await database.sql`
        INSERT INTO interview_recordings (
          organization_id, interview_session_id, file_id, recording_type, participant_scope
        ) VALUES (
          ${organizationId}::uuid, ${interviewSessionId}::uuid, ${recordingFileId}::uuid, 'video', 'candidate'
        )
      `;
      await database.sql`
        INSERT INTO assessments (
          id, organization_id, job_id, rubric_version_id, assessment_type, title, instructions, status
        ) VALUES (
          ${assessmentId}::uuid, ${organizationId}::uuid, ${jobId}::uuid, ${rubricVersionId}::uuid,
          'coding', 'Privacy Assessment', 'Solve the task', 'published'
        )
      `;
      await database.sql`
        INSERT INTO assessment_sessions (id, organization_id, assessment_id, application_id, status)
        VALUES (${assessmentSessionId}::uuid, ${organizationId}::uuid, ${assessmentId}::uuid, ${applicationId}::uuid, 'submitted')
      `;
      await database.sql`
        INSERT INTO assessment_submissions (
          id, organization_id, assessment_session_id, language, source_text, artifact_file_id
        ) VALUES (
          ${submissionId}::uuid, ${organizationId}::uuid, ${assessmentSessionId}::uuid,
          'javascript', 'console.log(1)', ${assessmentFileId}::uuid
        )
      `;
      await database.sql`
        INSERT INTO assessment_results (
          organization_id, assessment_session_id, submission_id, runner_type, runner_version, status, details
        ) VALUES (
          ${organizationId}::uuid, ${assessmentSessionId}::uuid, ${submissionId}::uuid,
          'sandbox', 'test-v1', 'completed', ${database.sql.json({ stdout: "candidate output" } as never)}
        )
      `;
      await database.sql`
        INSERT INTO sourcing_runs (id, organization_id, job_id, status)
        VALUES (${sourcingRunId}::uuid, ${organizationId}::uuid, ${jobId}::uuid, 'completed')
      `;
      await database.sql`
        INSERT INTO discovered_candidates (
          organization_id, sourcing_run_id, candidate_id, source_type, normalized_identity, profile_snapshot
        ) VALUES (
          ${organizationId}::uuid, ${sourcingRunId}::uuid, ${candidateId}::uuid, 'test',
          ${database.sql.json({ email: "delete-me@example.test" } as never)},
          ${database.sql.json({ name: "Delete Me" } as never)}
        )
      `;
      await database.sql`
        INSERT INTO ai_executions (
          id, organization_id, capability, provider, model, prompt_version, status, input_references, structured_output
        ) VALUES (
          ${aiExecutionId}::uuid, ${organizationId}::uuid, 'candidate.profile', 'test', 'test', 'v1', 'succeeded',
          ${database.sql.json({ candidateId } as never)}, ${database.sql.json({ summary: "derived", candidateId } as never)}
        )
      `;
      await database.sql`
        INSERT INTO ai_jobs (organization_id, execution_id, capability, payload, status)
        VALUES (
          ${organizationId}::uuid, ${aiExecutionId}::uuid, 'candidate.profile',
          ${database.sql.json({ candidateId } as never)}, 'succeeded'
        )
      `;
      await database.sql`
        INSERT INTO automation_rules (
          id, organization_id, name, trigger_type, action_type, approval_required, enabled
        ) VALUES (${automationRuleId}::uuid, ${organizationId}::uuid, 'Privacy rule', 'candidate.updated', 'notify', true, false)
      `;
      await database.sql`
        INSERT INTO automation_runs (organization_id, rule_id, idempotency_key, input, output, state)
        VALUES (
          ${organizationId}::uuid, ${automationRuleId}::uuid, ${`privacy-${candidateId}`},
          ${database.sql.json({ candidateId, email: "delete-me@example.test" } as never)},
          ${database.sql.json({ candidateId, score: 80 } as never)}, 'succeeded'
        )
      `;
      await database.sql`
        INSERT INTO integration_connections (id, organization_id, provider_key, connection_type)
        VALUES (${integrationId}::uuid, ${organizationId}::uuid, 'test-provider', 'ats')
      `;
      await database.sql`
        INSERT INTO integration_webhook_events (
          organization_id, integration_id, provider_event_id, event_type, payload
        ) VALUES (
          ${organizationId}::uuid, ${integrationId}::uuid, ${`event-${candidateId}`}, 'candidate.updated',
          ${database.sql.json({ candidateId, email: "delete-me@example.test" } as never)}
        )
      `;
      await database.sql`
        INSERT INTO audit_events (organization_id, actor_type, action, entity_type, entity_id, before, after, metadata)
        VALUES (
          ${organizationId}::uuid, 'system', 'candidate.test', 'candidate', ${candidateId},
          ${database.sql.json({ candidateId, email: "delete-me@example.test" } as never)},
          ${database.sql.json({ candidateId, stage: "interview" } as never)},
          ${database.sql.json({ candidateId } as never)}
        )
      `;
      await database.sql`
        INSERT INTO privacy_requests (id, organization_id, candidate_id, request_type, status, metadata)
        VALUES (
          ${privacyRequestId}::uuid, ${organizationId}::uuid, ${candidateId}::uuid,
          'deletion', 'pending_review', ${database.sql.json({ source: "integration" } as never)}
        )
      `;

      await queue.approvePrivacyRequest({
        organizationId,
        requestId: privacyRequestId,
        reviewerUserId: reviewerId,
        reviewNotes: "verified deletion request",
      });
      const claim = await queue.claim("privacy-integration-worker", 30_000);
      assert.equal(claim?.privacyRequestId, privacyRequestId);
      assert.ok(claim?.leaseToken);
      assert.equal(
        await legalHoldGate.blockIfHeld({
          jobId: claim!.jobId,
          leaseToken: claim!.leaseToken!,
          workerId: "privacy-integration-worker",
        }),
        null,
      );
      const result = await queue.execute(claim!.jobId, claim!.leaseToken!, "privacy-integration-worker");
      assert.equal(result.state, "succeeded");
      assert.deepEqual(new Set(memory.deleted), new Set([resumeKey, recordingKey, assessmentKey]));
      assert.equal(memory.objects.size, 0);

      const candidateRows = await database.sql`
        SELECT id FROM candidates WHERE organization_id=${organizationId}::uuid AND id=${candidateId}::uuid
      `;
      assert.equal(candidateRows.length, 0);
      const requestRows = await database.sql`
        SELECT candidate_id, status, subject_digest FROM privacy_requests
        WHERE organization_id=${organizationId}::uuid AND id=${privacyRequestId}::uuid
      `;
      assert.equal(requestRows[0]?.candidate_id, null);
      assert.equal(requestRows[0]?.status, "completed");
      assert.match(String(requestRows[0]?.subject_digest), /^[0-9a-f]{64}$/);
      const receiptRows = await database.sql`
        SELECT candidate_reference_hash, subject_digest, storage_object_count, storage_bytes,
               deleted_counts, deletion_summary, verification
        FROM privacy_deletion_receipts
        WHERE organization_id=${organizationId}::uuid AND privacy_request_id=${privacyRequestId}::uuid
      `;
      assert.equal(Number(receiptRows[0]?.storage_object_count), 3);
      assert.equal(String(receiptRows[0]?.candidate_reference_hash), String(receiptRows[0]?.subject_digest));
      assert.deepEqual(receiptRows[0]?.deletion_summary, receiptRows[0]?.deleted_counts);
      assert.equal((receiptRows[0]?.verification as Record<string, unknown>)?.storageObjectsVerifiedAbsent, true);

      for (const table of [
        "resumes",
        "resume_documents",
        "resume_chunks",
        "resume_chunk_embeddings",
        "evidence",
        "interview_sessions",
        "interview_transcript_segments",
        "interview_evidence",
        "assessment_sessions",
        "assessment_submissions",
        "assessment_results",
        "discovered_candidates",
        "ai_jobs",
        "ai_executions",
      ]) {
        const rows = await database.sql.unsafe(
          `SELECT count(*)::int AS count FROM ${table} WHERE organization_id = $1::uuid`,
          [organizationId],
        );
        assert.equal(Number(rows[0]?.count), 0, `${table} should contain no candidate-derived integration rows`);
      }
      const fileRows = await database.sql`
        SELECT storage_key FROM files
        WHERE organization_id=${organizationId}::uuid
          AND storage_key IN (${resumeKey}, ${recordingKey}, ${assessmentKey})
      `;
      assert.equal(fileRows.length, 0);
      const automationRows = await database.sql`
        SELECT input, output FROM automation_runs
        WHERE organization_id=${organizationId}::uuid AND rule_id=${automationRuleId}::uuid
      `;
      assert.deepEqual(automationRows[0]?.input, { privacyRedacted: true });
      assert.deepEqual(automationRows[0]?.output, { privacyRedacted: true });
      const webhookRows = await database.sql`
        SELECT payload FROM integration_webhook_events
        WHERE organization_id=${organizationId}::uuid AND integration_id=${integrationId}::uuid
      `;
      assert.deepEqual(webhookRows[0]?.payload, { privacyRedacted: true });
      const auditRows = await database.sql`
        SELECT entity_id, before, after, metadata FROM audit_events
        WHERE organization_id=${organizationId}::uuid AND action='candidate.test'
      `;
      assert.equal(auditRows[0]?.entity_id, null);
      assert.deepEqual(auditRows[0]?.before, { privacyRedacted: true });
      assert.deepEqual(auditRows[0]?.after, { privacyRedacted: true });
      assert.deepEqual(auditRows[0]?.metadata, { privacyRedacted: true });

      const heldCandidateId = randomUUID();
      const heldRequestId = randomUUID();
      await database.sql`
        INSERT INTO candidates (id, organization_id, display_name)
        VALUES (${heldCandidateId}::uuid, ${organizationId}::uuid, 'Held Candidate')
      `;
      await database.sql`
        INSERT INTO privacy_requests (id, organization_id, candidate_id, request_type, status)
        VALUES (${heldRequestId}::uuid, ${organizationId}::uuid, ${heldCandidateId}::uuid, 'deletion', 'pending_review')
      `;
      await database.sql`
        INSERT INTO legal_holds (organization_id, candidate_id, reason, status, placed_by_user_id)
        VALUES (${organizationId}::uuid, ${heldCandidateId}::uuid, 'litigation preservation', 'active', ${reviewerId}::uuid)
      `;
      await queue.approvePrivacyRequest({
        organizationId,
        requestId: heldRequestId,
        reviewerUserId: reviewerId,
        reviewNotes: "request verified but legal hold applies",
      });
      const heldClaim = await queue.claim("privacy-integration-worker", 30_000);
      assert.equal(heldClaim?.privacyRequestId, heldRequestId);
      const blocked = await legalHoldGate.blockIfHeld({
        jobId: heldClaim!.jobId,
        leaseToken: heldClaim!.leaseToken!,
        workerId: "privacy-integration-worker",
      });
      assert.equal(blocked?.state, "blocked");
      assert.equal(blocked?.errorCode, "LEGAL_HOLD");
      const heldState = await database.sql`
        SELECT request.status, job.state
        FROM privacy_requests request
        JOIN privacy_deletion_jobs job
          ON job.organization_id=request.organization_id AND job.privacy_request_id=request.id
        WHERE request.organization_id=${organizationId}::uuid AND request.id=${heldRequestId}::uuid
      `;
      assert.equal(heldState[0]?.status, "deletion_blocked");
      assert.equal(heldState[0]?.state, "blocked");
      const heldCandidate = await database.sql`
        SELECT id FROM candidates WHERE organization_id=${organizationId}::uuid AND id=${heldCandidateId}::uuid
      `;
      assert.equal(heldCandidate.length, 1);
    } finally {
      await database.sql`DELETE FROM organizations WHERE id = ${organizationId}::uuid`;
      await database.sql`DELETE FROM users WHERE id = ${reviewerId}::uuid`;
      await database.onModuleDestroy();
    }
  },
);

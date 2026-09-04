import { createHash, randomUUID } from "node:crypto";
import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { STORAGE_PROVIDER, type StorageProvider } from "../storage/storage-provider";

const MIN_LEASE_MS = 5_000;
const MAX_LEASE_MS = 300_000;
const DEFAULT_LEASE_MS = 120_000;
const MAX_PLAN_RESYNCS = 4;

interface PrivacyDeletionJobRow {
  id: string;
  organization_id: string;
  privacy_request_id: string;
  candidate_id: string | null;
  subject_digest: string;
  state: "queued" | "claimed" | "retry_scheduled" | "succeeded" | "failed" | "blocked" | "cancelled";
  attempt_count: number;
  max_attempts: number;
  available_at: Date | string;
  worker_id: string | null;
  lease_token: string | null;
  lease_expires_at: Date | string | null;
  planned_counts: Record<string, unknown> | null;
}

interface PlannedObjectRow {
  id: string;
  file_id: string | null;
  storage_key: string;
  size_bytes: number | string;
  state: "pending" | "deleted" | "failed";
}

interface PrivacyRequestRow {
  id: string;
  candidate_id: string | null;
  request_type: string;
  status: string;
  requested_at: Date | string;
  review_notes: string | null;
  completed_at: Date | string | null;
  metadata: Record<string, unknown> | null;
  subject_digest: string | null;
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function computePrivacyDeletionRetryDelayMs(attemptCount: number): number {
  const attempt = Math.max(1, Math.trunc(attemptCount));
  return Math.min(60_000, 1_000 * 2 ** Math.min(attempt - 1, 6));
}

export function privacySubjectDigest(organizationId: string, candidateId: string): string {
  return createHash("sha256").update(`${organizationId}:${candidateId}`, "utf8").digest("hex");
}

@Injectable()
export class PrivacyDeletionQueueService {
  constructor(
    private readonly database: DatabaseService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async approvePrivacyRequest(input: {
    organizationId: string;
    requestId: string;
    reviewerUserId: string;
    reviewNotes: string;
  }): Promise<Record<string, unknown>> {
    return this.database.sql.begin(async (tx) => {
      const requests = await tx`
        SELECT id::text, candidate_id::text, request_type, status, requested_at,
               review_notes, completed_at, metadata, subject_digest
        FROM privacy_requests
        WHERE organization_id = ${input.organizationId}::uuid
          AND id = ${input.requestId}::uuid
          AND status = 'pending_review'
        LIMIT 1
        FOR UPDATE
      `;
      const request = requests[0] as PrivacyRequestRow | undefined;
      if (!request) throw new Error("Pending privacy request not found");

      if (request.request_type !== "deletion") {
        const updated = await tx`
          UPDATE privacy_requests
          SET status = 'approved_pending_execution',
              reviewed_by_user_id = ${input.reviewerUserId}::uuid,
              review_notes = ${input.reviewNotes.trim()},
              updated_at = now()
          WHERE organization_id = ${input.organizationId}::uuid
            AND id = ${input.requestId}::uuid
          RETURNING id::text, candidate_id::text, request_type, status, requested_at,
                    review_notes, completed_at, metadata, subject_digest
        `;
        return this.mapRequest(updated[0] as PrivacyRequestRow | undefined);
      }

      const candidateId = request.candidate_id;
      if (!candidateId) throw new Error("Deletion request no longer has a candidate subject");
      const digest = privacySubjectDigest(input.organizationId, candidateId);
      const jobs = await tx`
        INSERT INTO privacy_deletion_jobs (
          organization_id, privacy_request_id, candidate_id, subject_digest
        ) VALUES (
          ${input.organizationId}::uuid,
          ${input.requestId}::uuid,
          ${candidateId}::uuid,
          ${digest}
        )
        ON CONFLICT (organization_id, privacy_request_id)
        DO UPDATE SET updated_at = now()
        RETURNING id::text
      `;
      const jobId = jobs[0]?.id;
      if (!jobId) throw new Error("Failed to create privacy deletion job");

      const updated = await tx`
        UPDATE privacy_requests
        SET status = 'approved_pending_execution',
            reviewed_by_user_id = ${input.reviewerUserId}::uuid,
            review_notes = ${input.reviewNotes.trim()},
            subject_digest = ${digest},
            metadata = COALESCE(metadata, '{}'::jsonb) || ${tx.json({ deletionJobId: String(jobId) } as never)},
            updated_at = now()
        WHERE organization_id = ${input.organizationId}::uuid
          AND id = ${input.requestId}::uuid
        RETURNING id::text, candidate_id::text, request_type, status, requested_at,
                  review_notes, completed_at, metadata, subject_digest
      `;
      return this.mapRequest(updated[0] as PrivacyRequestRow | undefined);
    });
  }

  async claim(workerId: string, requestedLeaseMs?: number) {
    const normalizedWorkerId = workerId.trim();
    if (!normalizedWorkerId) throw new Error("workerId is required");
    const leaseMs = boundedInteger(requestedLeaseMs, DEFAULT_LEASE_MS, MIN_LEASE_MS, MAX_LEASE_MS);
    const leaseToken = randomUUID();

    return this.database.sql.begin(async (tx) => {
      const expired = await tx`
        UPDATE privacy_deletion_jobs
        SET
          state = CASE WHEN attempt_count >= max_attempts THEN 'failed' ELSE 'retry_scheduled' END,
          available_at = CASE
            WHEN attempt_count >= max_attempts THEN available_at
            ELSE now() + interval '1 second'
          END,
          worker_id = NULL,
          lease_token = NULL,
          lease_expires_at = NULL,
          last_error_code = 'LEASE_EXPIRED',
          last_error = 'Privacy deletion worker lease expired before completion',
          completed_at = CASE WHEN attempt_count >= max_attempts THEN now() ELSE NULL END,
          updated_at = now()
        WHERE state = 'claimed'
          AND lease_expires_at IS NOT NULL
          AND lease_expires_at <= now()
        RETURNING organization_id::text, privacy_request_id::text, state
      `;

      for (const row of expired as unknown as Array<{ organization_id: string; privacy_request_id: string; state: string }>) {
        await tx`
          UPDATE privacy_requests
          SET status = ${row.state === "failed" ? "execution_failed" : "approved_pending_execution"},
              updated_at = now()
          WHERE organization_id = ${row.organization_id}::uuid
            AND id = ${row.privacy_request_id}::uuid
        `;
      }

      const rows = await tx`
        WITH candidate AS (
          SELECT id
          FROM privacy_deletion_jobs
          WHERE state IN ('queued', 'retry_scheduled')
            AND available_at <= now()
            AND attempt_count < max_attempts
          ORDER BY available_at ASC, created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE privacy_deletion_jobs AS job
        SET state = 'claimed',
            attempt_count = job.attempt_count + 1,
            worker_id = ${normalizedWorkerId},
            lease_token = ${leaseToken}::uuid,
            lease_expires_at = now() + (${leaseMs} * interval '1 millisecond'),
            claimed_at = now(),
            started_at = COALESCE(job.started_at, now()),
            last_error_code = NULL,
            last_error = NULL,
            updated_at = now()
        FROM candidate
        WHERE job.id = candidate.id
        RETURNING job.*
      `;
      const row = rows[0] as PrivacyDeletionJobRow | undefined;
      if (!row) return null;

      await tx`
        UPDATE privacy_requests
        SET status = 'execution_in_progress', updated_at = now()
        WHERE organization_id = ${row.organization_id}::uuid
          AND id = ${row.privacy_request_id}::uuid
      `;

      return {
        jobId: row.id,
        privacyRequestId: row.privacy_request_id,
        subjectDigest: row.subject_digest,
        leaseToken: row.lease_token,
        leaseExpiresAt: iso(row.lease_expires_at),
        attemptCount: row.attempt_count,
        maxAttempts: row.max_attempts,
      };
    });
  }

  async heartbeat(jobId: string, leaseToken: string, workerId: string, requestedLeaseMs?: number) {
    const leaseMs = boundedInteger(requestedLeaseMs, DEFAULT_LEASE_MS, MIN_LEASE_MS, MAX_LEASE_MS);
    const rows = await this.database.sql`
      UPDATE privacy_deletion_jobs
      SET lease_expires_at = now() + (${leaseMs} * interval '1 millisecond'), updated_at = now()
      WHERE id = ${jobId}::uuid
        AND state = 'claimed'
        AND lease_token = ${leaseToken}::uuid
        AND worker_id = ${workerId}
        AND lease_expires_at > now()
      RETURNING id::text, state, lease_expires_at
    `;
    const row = rows[0];
    if (!row) throw new ConflictException("Privacy deletion job lease is no longer owned by this worker");
    return {
      jobId: String(row.id),
      state: String(row.state),
      leaseExpiresAt: new Date(String(row.lease_expires_at)).toISOString(),
    };
  }

  async execute(jobId: string, leaseToken: string, workerId: string) {
    for (let iteration = 0; iteration < MAX_PLAN_RESYNCS; iteration += 1) {
      const job = await this.requireOwnedJob(jobId, leaseToken, workerId);
      const candidateId = job.candidate_id;
      if (!candidateId) {
        const receipt = await this.database.sql`
          SELECT id::text, deleted_counts, storage_object_count, storage_bytes, verification, completed_at
          FROM privacy_deletion_receipts
          WHERE organization_id = ${job.organization_id}::uuid
            AND deletion_job_id = ${job.id}::uuid
          LIMIT 1
        `;
        if (receipt[0]) return { jobId, state: "succeeded" as const, receipt: receipt[0] };
        throw new Error("Privacy deletion job lost its candidate before a completion receipt was persisted");
      }

      const legalHold = await this.findLegalHold(job.organization_id, candidateId);
      if (legalHold) {
        return this.block(job, "LEGAL_HOLD", legalHold);
      }

      await this.synchronizeDeletionPlan(job.organization_id, job.id, candidateId);
      const shared = await this.findSharedStorageReference(job.organization_id, job.id, candidateId);
      if (shared) {
        return this.block(job, "SHARED_STORAGE_OBJECT", `Storage key is referenced by another candidate: ${shared}`);
      }

      await this.eraseStorageObjects(job.organization_id, job.id);
      const final = await this.finalizeDatabaseDeletion(job, leaseToken, workerId);
      if (final.needsResync) continue;
      return final.result;
    }

    throw new Error("Privacy deletion plan changed repeatedly while execution was in progress");
  }

  async fail(input: {
    jobId: string;
    leaseToken: string;
    workerId: string;
    retryable: boolean;
    errorCode: string;
    errorMessage: string;
  }) {
    return this.database.sql.begin(async (tx) => {
      const rows = await tx`
        SELECT * FROM privacy_deletion_jobs
        WHERE id = ${input.jobId}::uuid
          AND state = 'claimed'
          AND lease_token = ${input.leaseToken}::uuid
          AND worker_id = ${input.workerId}
          AND lease_expires_at > now()
        FOR UPDATE
      `;
      const current = rows[0] as PrivacyDeletionJobRow | undefined;
      if (!current) throw new ConflictException("Privacy deletion failure report rejected because the lease is stale");

      const willRetry = input.retryable && current.attempt_count < current.max_attempts;
      const delayMs = willRetry ? computePrivacyDeletionRetryDelayMs(current.attempt_count) : 0;
      const nextState = willRetry ? "retry_scheduled" : "failed";
      const updated = await tx`
        UPDATE privacy_deletion_jobs
        SET state = ${nextState},
            available_at = CASE
              WHEN ${willRetry} THEN now() + (${delayMs} * interval '1 millisecond')
              ELSE available_at
            END,
            worker_id = NULL,
            lease_token = NULL,
            lease_expires_at = NULL,
            last_error_code = ${input.errorCode.slice(0, 120)},
            last_error = ${input.errorMessage.slice(0, 4000)},
            completed_at = CASE WHEN ${willRetry} THEN NULL ELSE now() END,
            updated_at = now()
        WHERE id = ${input.jobId}::uuid
        RETURNING id::text, state, attempt_count, max_attempts, privacy_request_id::text
      `;
      const row = updated[0];
      if (!row) throw new Error("Failed to persist privacy deletion failure state");
      await tx`
        UPDATE privacy_requests
        SET status = ${willRetry ? "approved_pending_execution" : "execution_failed"},
            updated_at = now()
        WHERE organization_id = ${current.organization_id}::uuid
          AND id = ${String(row.privacy_request_id)}::uuid
      `;
      return {
        jobId: String(row.id),
        state: String(row.state),
        attemptCount: Number(row.attempt_count),
        maxAttempts: Number(row.max_attempts),
        retryDelayMs: delayMs,
      };
    });
  }

  private async requireOwnedJob(jobId: string, leaseToken: string, workerId: string): Promise<PrivacyDeletionJobRow> {
    const rows = await this.database.sql`
      SELECT * FROM privacy_deletion_jobs
      WHERE id = ${jobId}::uuid
        AND state = 'claimed'
        AND lease_token = ${leaseToken}::uuid
        AND worker_id = ${workerId}
        AND lease_expires_at > now()
      LIMIT 1
    `;
    const row = rows[0] as PrivacyDeletionJobRow | undefined;
    if (!row) throw new ConflictException("Privacy deletion job lease is stale");
    return row;
  }

  private async findLegalHold(organizationId: string, candidateId: string): Promise<string | null> {
    const applicationRows = await this.database.sql`
      SELECT id::text FROM applications
      WHERE organization_id = ${organizationId}::uuid AND candidate_id = ${candidateId}::uuid
    `;
    const applicationIds = new Set(applicationRows.map((row) => String(row.id)));
    const policies = await this.database.sql`
      SELECT entity_type, legal_hold_rules
      FROM retention_policies
      WHERE organization_id = ${organizationId}::uuid AND enabled = true
    `;
    for (const policy of policies) {
      const rules = policy.legal_hold_rules;
      if (!rules || typeof rules !== "object" || Array.isArray(rules)) continue;
      const value = rules as Record<string, unknown>;
      if (value.allCandidates === true) return `Retention policy ${String(policy.entity_type)} places all candidates on legal hold`;
      if (Array.isArray(value.candidateIds) && value.candidateIds.some((id) => String(id) === candidateId)) {
        return `Retention policy ${String(policy.entity_type)} places this candidate on legal hold`;
      }
      if (
        Array.isArray(value.applicationIds) &&
        value.applicationIds.some((id) => applicationIds.has(String(id)))
      ) {
        return `Retention policy ${String(policy.entity_type)} places a candidate application on legal hold`;
      }
    }
    return null;
  }

  private async synchronizeDeletionPlan(organizationId: string, jobId: string, candidateId: string): Promise<void> {
    await this.database.sql.begin(async (tx) => {
      const candidate = await tx`
        SELECT id FROM candidates
        WHERE organization_id = ${organizationId}::uuid AND id = ${candidateId}::uuid
        LIMIT 1
      `;
      if (!candidate[0]) return;

      await tx`
        WITH candidate_files AS (
          SELECT r.file_id, f.storage_key, f.size_bytes, 'resume'::text AS source_type
          FROM resumes r
          JOIN files f ON f.organization_id = r.organization_id AND f.id = r.file_id
          WHERE r.organization_id = ${organizationId}::uuid AND r.candidate_id = ${candidateId}::uuid
          UNION ALL
          SELECT ir.file_id, f.storage_key, f.size_bytes, 'interview_recording'::text AS source_type
          FROM interview_recordings ir
          JOIN interview_sessions s
            ON s.organization_id = ir.organization_id AND s.id = ir.interview_session_id
          JOIN applications a
            ON a.organization_id = s.organization_id AND a.id = s.application_id
          JOIN files f ON f.organization_id = ir.organization_id AND f.id = ir.file_id
          WHERE ir.organization_id = ${organizationId}::uuid AND a.candidate_id = ${candidateId}::uuid
          UNION ALL
          SELECT sub.artifact_file_id AS file_id, f.storage_key, f.size_bytes, 'assessment_artifact'::text AS source_type
          FROM assessment_submissions sub
          JOIN assessment_sessions ses
            ON ses.organization_id = sub.organization_id AND ses.id = sub.assessment_session_id
          JOIN applications a
            ON a.organization_id = ses.organization_id AND a.id = ses.application_id
          JOIN files f ON f.organization_id = sub.organization_id AND f.id = sub.artifact_file_id
          WHERE sub.organization_id = ${organizationId}::uuid
            AND a.candidate_id = ${candidateId}::uuid
            AND sub.artifact_file_id IS NOT NULL
        ), deduped AS (
          SELECT DISTINCT ON (storage_key) file_id, storage_key, size_bytes, source_type
          FROM candidate_files
          ORDER BY storage_key, source_type, file_id
        )
        INSERT INTO privacy_deletion_objects (
          organization_id, deletion_job_id, file_id, storage_key, source_type, size_bytes
        )
        SELECT ${organizationId}::uuid, ${jobId}::uuid, file_id, storage_key, source_type, size_bytes
        FROM deduped
        ON CONFLICT (organization_id, deletion_job_id, storage_key)
        DO UPDATE SET
          file_id = COALESCE(privacy_deletion_objects.file_id, EXCLUDED.file_id),
          size_bytes = GREATEST(privacy_deletion_objects.size_bytes, EXCLUDED.size_bytes),
          source_type = EXCLUDED.source_type,
          updated_at = now()
      `;

      const counts = await tx`
        SELECT
          (SELECT count(*) FROM applications WHERE organization_id = ${organizationId}::uuid AND candidate_id = ${candidateId}::uuid)::int AS applications,
          (SELECT count(*) FROM resumes WHERE organization_id = ${organizationId}::uuid AND candidate_id = ${candidateId}::uuid)::int AS resumes,
          (SELECT count(*) FROM resume_documents d JOIN resumes r ON r.organization_id=d.organization_id AND r.id=d.resume_id WHERE d.organization_id=${organizationId}::uuid AND r.candidate_id=${candidateId}::uuid)::int AS resume_documents,
          (SELECT count(*) FROM resume_chunks c JOIN resumes r ON r.organization_id=c.organization_id AND r.id=c.resume_id WHERE c.organization_id=${organizationId}::uuid AND r.candidate_id=${candidateId}::uuid)::int AS resume_chunks,
          (SELECT count(*) FROM resume_chunk_embeddings e JOIN resumes r ON r.organization_id=e.organization_id AND r.id=e.resume_id WHERE e.organization_id=${organizationId}::uuid AND r.candidate_id=${candidateId}::uuid)::int AS resume_embeddings,
          (SELECT count(*) FROM evidence WHERE organization_id=${organizationId}::uuid AND candidate_id=${candidateId}::uuid)::int AS evidence,
          (SELECT count(*) FROM interview_sessions s JOIN applications a ON a.organization_id=s.organization_id AND a.id=s.application_id WHERE s.organization_id=${organizationId}::uuid AND a.candidate_id=${candidateId}::uuid)::int AS interview_sessions,
          (SELECT count(*) FROM interview_transcript_segments t JOIN interview_sessions s ON s.organization_id=t.organization_id AND s.id=t.interview_session_id JOIN applications a ON a.organization_id=s.organization_id AND a.id=s.application_id WHERE t.organization_id=${organizationId}::uuid AND a.candidate_id=${candidateId}::uuid)::int AS transcript_segments,
          (SELECT count(*) FROM interview_evidence ie JOIN interview_sessions s ON s.organization_id=ie.organization_id AND s.id=ie.interview_session_id JOIN applications a ON a.organization_id=s.organization_id AND a.id=s.application_id WHERE ie.organization_id=${organizationId}::uuid AND a.candidate_id=${candidateId}::uuid)::int AS interview_evidence,
          (SELECT count(*) FROM assessment_sessions ses JOIN applications a ON a.organization_id=ses.organization_id AND a.id=ses.application_id WHERE ses.organization_id=${organizationId}::uuid AND a.candidate_id=${candidateId}::uuid)::int AS assessment_sessions,
          (SELECT count(*) FROM assessment_submissions sub JOIN assessment_sessions ses ON ses.organization_id=sub.organization_id AND ses.id=sub.assessment_session_id JOIN applications a ON a.organization_id=ses.organization_id AND a.id=ses.application_id WHERE sub.organization_id=${organizationId}::uuid AND a.candidate_id=${candidateId}::uuid)::int AS assessment_submissions,
          (SELECT count(*) FROM discovered_candidates WHERE organization_id=${organizationId}::uuid AND candidate_id=${candidateId}::uuid)::int AS sourcing_snapshots,
          (SELECT count(*) FROM conversations WHERE organization_id=${organizationId}::uuid AND candidate_id=${candidateId}::uuid)::int AS conversations,
          (SELECT count(*) FROM candidate_match_snapshots WHERE organization_id=${organizationId}::uuid AND candidate_id=${candidateId}::uuid)::int AS match_snapshots,
          (SELECT count(*) FROM privacy_deletion_objects WHERE organization_id=${organizationId}::uuid AND deletion_job_id=${jobId}::uuid)::int AS storage_objects
      `;
      const snapshot = counts[0] ?? {};
      await tx`
        UPDATE privacy_deletion_jobs
        SET planned_counts = ${tx.json(snapshot as never)},
            plan_initialized_at = COALESCE(plan_initialized_at, now()),
            updated_at = now()
        WHERE organization_id = ${organizationId}::uuid AND id = ${jobId}::uuid
      `;
    });
  }

  private async findSharedStorageReference(organizationId: string, jobId: string, candidateId: string): Promise<string | null> {
    const rows = await this.database.sql`
      SELECT object.storage_key
      FROM privacy_deletion_objects object
      WHERE object.organization_id = ${organizationId}::uuid
        AND object.deletion_job_id = ${jobId}::uuid
        AND EXISTS (
          SELECT 1
          FROM files f
          WHERE f.organization_id = object.organization_id
            AND f.storage_key = object.storage_key
            AND (
              EXISTS (
                SELECT 1 FROM resumes r
                WHERE r.organization_id=f.organization_id AND r.file_id=f.id
                  AND r.candidate_id <> ${candidateId}::uuid
              )
              OR EXISTS (
                SELECT 1
                FROM interview_recordings ir
                JOIN interview_sessions s ON s.organization_id=ir.organization_id AND s.id=ir.interview_session_id
                JOIN applications a ON a.organization_id=s.organization_id AND a.id=s.application_id
                WHERE ir.organization_id=f.organization_id AND ir.file_id=f.id
                  AND a.candidate_id <> ${candidateId}::uuid
              )
              OR EXISTS (
                SELECT 1
                FROM assessment_submissions sub
                JOIN assessment_sessions ses ON ses.organization_id=sub.organization_id AND ses.id=sub.assessment_session_id
                JOIN applications a ON a.organization_id=ses.organization_id AND a.id=ses.application_id
                WHERE sub.organization_id=f.organization_id AND sub.artifact_file_id=f.id
                  AND a.candidate_id <> ${candidateId}::uuid
              )
            )
        )
      LIMIT 1
    `;
    return rows[0]?.storage_key ? String(rows[0].storage_key) : null;
  }

  private async eraseStorageObjects(organizationId: string, jobId: string): Promise<void> {
    const rows = await this.database.sql`
      SELECT id::text, file_id::text, storage_key, size_bytes, state
      FROM privacy_deletion_objects
      WHERE organization_id = ${organizationId}::uuid
        AND deletion_job_id = ${jobId}::uuid
        AND state IN ('pending', 'failed')
      ORDER BY created_at, storage_key
    `;

    for (const raw of rows) {
      const object = raw as unknown as PlannedObjectRow;
      try {
        await this.storage.delete(object.storage_key);
        if (await this.storage.exists(object.storage_key)) {
          throw new Error("Storage provider reports object still exists after delete");
        }
        await this.database.sql`
          UPDATE privacy_deletion_objects
          SET state='deleted', last_error=NULL, deleted_at=now(), updated_at=now()
          WHERE organization_id=${organizationId}::uuid AND id=${object.id}::uuid
        `;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.database.sql`
          UPDATE privacy_deletion_objects
          SET state='failed', last_error=${message.slice(0, 4000)}, updated_at=now()
          WHERE organization_id=${organizationId}::uuid AND id=${object.id}::uuid
        `;
        throw new Error(`Failed to erase storage object ${object.storage_key}: ${message}`);
      }
    }
  }

  private async finalizeDatabaseDeletion(
    expectedJob: PrivacyDeletionJobRow,
    leaseToken: string,
    workerId: string,
  ): Promise<{ needsResync: true } | { needsResync: false; result: Record<string, unknown> }> {
    return this.database.sql.begin(async (tx) => {
      const jobs = await tx`
        SELECT * FROM privacy_deletion_jobs
        WHERE id=${expectedJob.id}::uuid
          AND state='claimed'
          AND lease_token=${leaseToken}::uuid
          AND worker_id=${workerId}
          AND lease_expires_at > now()
        FOR UPDATE
      `;
      const job = jobs[0] as PrivacyDeletionJobRow | undefined;
      if (!job) throw new ConflictException("Privacy deletion finalization rejected because the lease is stale");
      const candidateId = job.candidate_id;
      if (!candidateId) throw new Error("Privacy deletion candidate disappeared before finalization");

      const candidate = await tx`
        SELECT id FROM candidates
        WHERE organization_id=${job.organization_id}::uuid AND id=${candidateId}::uuid
        FOR UPDATE
      `;
      if (!candidate[0]) throw new Error("Privacy deletion candidate disappeared without a completion receipt");

      await tx`
        SELECT id FROM applications
        WHERE organization_id=${job.organization_id}::uuid AND candidate_id=${candidateId}::uuid
        FOR UPDATE
      `;
      await tx`
        SELECT s.id
        FROM interview_sessions s
        JOIN applications a ON a.organization_id=s.organization_id AND a.id=s.application_id
        WHERE s.organization_id=${job.organization_id}::uuid AND a.candidate_id=${candidateId}::uuid
        FOR UPDATE OF s
      `;
      await tx`
        SELECT ses.id
        FROM assessment_sessions ses
        JOIN applications a ON a.organization_id=ses.organization_id AND a.id=ses.application_id
        WHERE ses.organization_id=${job.organization_id}::uuid AND a.candidate_id=${candidateId}::uuid
        FOR UPDATE OF ses
      `;
      await tx`
        SELECT id FROM resumes
        WHERE organization_id=${job.organization_id}::uuid AND candidate_id=${candidateId}::uuid
        FOR UPDATE
      `;

      const unplanned = await tx`
        WITH candidate_files AS (
          SELECT f.storage_key
          FROM resumes r JOIN files f ON f.organization_id=r.organization_id AND f.id=r.file_id
          WHERE r.organization_id=${job.organization_id}::uuid AND r.candidate_id=${candidateId}::uuid
          UNION
          SELECT f.storage_key
          FROM interview_recordings ir
          JOIN interview_sessions s ON s.organization_id=ir.organization_id AND s.id=ir.interview_session_id
          JOIN applications a ON a.organization_id=s.organization_id AND a.id=s.application_id
          JOIN files f ON f.organization_id=ir.organization_id AND f.id=ir.file_id
          WHERE ir.organization_id=${job.organization_id}::uuid AND a.candidate_id=${candidateId}::uuid
          UNION
          SELECT f.storage_key
          FROM assessment_submissions sub
          JOIN assessment_sessions ses ON ses.organization_id=sub.organization_id AND ses.id=sub.assessment_session_id
          JOIN applications a ON a.organization_id=ses.organization_id AND a.id=ses.application_id
          JOIN files f ON f.organization_id=sub.organization_id AND f.id=sub.artifact_file_id
          WHERE sub.organization_id=${job.organization_id}::uuid
            AND a.candidate_id=${candidateId}::uuid AND sub.artifact_file_id IS NOT NULL
        )
        SELECT candidate_files.storage_key
        FROM candidate_files
        LEFT JOIN privacy_deletion_objects object
          ON object.organization_id=${job.organization_id}::uuid
          AND object.deletion_job_id=${job.id}::uuid
          AND object.storage_key=candidate_files.storage_key
          AND object.state='deleted'
        WHERE object.id IS NULL
        LIMIT 1
      `;
      if (unplanned[0]) return { needsResync: true as const };

      const failedObjects = await tx`
        SELECT id FROM privacy_deletion_objects
        WHERE organization_id=${job.organization_id}::uuid
          AND deletion_job_id=${job.id}::uuid AND state <> 'deleted'
        LIMIT 1
      `;
      if (failedObjects[0]) return { needsResync: true as const };

      const shared = await tx`
        SELECT object.storage_key
        FROM privacy_deletion_objects object
        WHERE object.organization_id=${job.organization_id}::uuid
          AND object.deletion_job_id=${job.id}::uuid
          AND EXISTS (
            SELECT 1 FROM files f
            WHERE f.organization_id=object.organization_id AND f.storage_key=object.storage_key
              AND (
                EXISTS (SELECT 1 FROM resumes r WHERE r.organization_id=f.organization_id AND r.file_id=f.id AND r.candidate_id <> ${candidateId}::uuid)
                OR EXISTS (
                  SELECT 1 FROM interview_recordings ir
                  JOIN interview_sessions s ON s.organization_id=ir.organization_id AND s.id=ir.interview_session_id
                  JOIN applications a ON a.organization_id=s.organization_id AND a.id=s.application_id
                  WHERE ir.organization_id=f.organization_id AND ir.file_id=f.id AND a.candidate_id <> ${candidateId}::uuid
                )
                OR EXISTS (
                  SELECT 1 FROM assessment_submissions sub
                  JOIN assessment_sessions ses ON ses.organization_id=sub.organization_id AND ses.id=sub.assessment_session_id
                  JOIN applications a ON a.organization_id=ses.organization_id AND a.id=ses.application_id
                  WHERE sub.organization_id=f.organization_id AND sub.artifact_file_id=f.id AND a.candidate_id <> ${candidateId}::uuid
                )
              )
          )
        LIMIT 1
      `;
      if (shared[0]) throw new Error(`Storage key became shared during deletion: ${String(shared[0].storage_key)}`);

      const anchorRows = await tx`
        SELECT ${candidateId}::text AS anchor
        UNION ALL SELECT id::text FROM applications WHERE organization_id=${job.organization_id}::uuid AND candidate_id=${candidateId}::uuid
        UNION ALL SELECT s.id::text FROM interview_sessions s JOIN applications a ON a.organization_id=s.organization_id AND a.id=s.application_id WHERE s.organization_id=${job.organization_id}::uuid AND a.candidate_id=${candidateId}::uuid
        UNION ALL SELECT ses.id::text FROM assessment_sessions ses JOIN applications a ON a.organization_id=ses.organization_id AND a.id=ses.application_id WHERE ses.organization_id=${job.organization_id}::uuid AND a.candidate_id=${candidateId}::uuid
        UNION ALL SELECT r.id::text FROM resumes r WHERE r.organization_id=${job.organization_id}::uuid AND r.candidate_id=${candidateId}::uuid
        UNION ALL SELECT e.id::text FROM evidence e WHERE e.organization_id=${job.organization_id}::uuid AND e.candidate_id=${candidateId}::uuid
        UNION ALL SELECT t.id::text FROM interview_transcript_segments t JOIN interview_sessions s ON s.organization_id=t.organization_id AND s.id=t.interview_session_id JOIN applications a ON a.organization_id=s.organization_id AND a.id=s.application_id WHERE t.organization_id=${job.organization_id}::uuid AND a.candidate_id=${candidateId}::uuid
        UNION ALL SELECT c.id::text FROM conversations c WHERE c.organization_id=${job.organization_id}::uuid AND c.candidate_id=${candidateId}::uuid
        UNION ALL SELECT sub.id::text FROM assessment_submissions sub JOIN assessment_sessions ses ON ses.organization_id=sub.organization_id AND ses.id=sub.assessment_session_id JOIN applications a ON a.organization_id=ses.organization_id AND a.id=ses.application_id WHERE sub.organization_id=${job.organization_id}::uuid AND a.candidate_id=${candidateId}::uuid
        UNION ALL SELECT ar.id::text FROM assessment_results ar JOIN assessment_sessions ses ON ses.organization_id=ar.organization_id AND ses.id=ar.assessment_session_id JOIN applications a ON a.organization_id=ses.organization_id AND a.id=ses.application_id WHERE ar.organization_id=${job.organization_id}::uuid AND a.candidate_id=${candidateId}::uuid
        UNION ALL SELECT sc.id::text FROM scorecards sc JOIN applications a ON a.organization_id=sc.organization_id AND a.id=sc.application_id WHERE sc.organization_id=${job.organization_id}::uuid AND a.candidate_id=${candidateId}::uuid
        UNION ALL SELECT ev.id::text FROM interview_evaluations ev JOIN interview_sessions s ON s.organization_id=ev.organization_id AND s.id=ev.interview_session_id JOIN applications a ON a.organization_id=s.organization_id AND a.id=s.application_id WHERE ev.organization_id=${job.organization_id}::uuid AND a.candidate_id=${candidateId}::uuid
      `;
      const anchors = [...new Set(anchorRows.map((row) => String(row.anchor)).filter(Boolean))];
      const anchorJson = tx.json(anchors as never);

      await tx`
        DELETE FROM evaluator_calibration_runs run
        USING interview_evaluations evaluation, interview_sessions session, applications application
        WHERE run.organization_id=${job.organization_id}::uuid
          AND run.ai_evaluation_id=evaluation.id
          AND evaluation.organization_id=run.organization_id
          AND session.organization_id=evaluation.organization_id
          AND session.id=evaluation.interview_session_id
          AND application.organization_id=session.organization_id
          AND application.id=session.application_id
          AND application.candidate_id=${candidateId}::uuid
      `;

      await tx`
        WITH anchors AS (SELECT value AS id FROM jsonb_array_elements_text(${anchorJson}))
        DELETE FROM ai_jobs job
        WHERE job.organization_id=${job.organization_id}::uuid
          AND (
            EXISTS (SELECT 1 FROM anchors a WHERE COALESCE(job.payload::text,'') LIKE '%' || a.id || '%' OR COALESCE(job.result::text,'') LIKE '%' || a.id || '%')
            OR job.execution_id IN (
              SELECT execution.id FROM ai_executions execution
              WHERE execution.organization_id=job.organization_id
                AND EXISTS (SELECT 1 FROM anchors a WHERE COALESCE(execution.input_references::text,'') LIKE '%' || a.id || '%' OR COALESCE(execution.structured_output::text,'') LIKE '%' || a.id || '%')
            )
          )
      `;
      await tx`
        WITH anchors AS (SELECT value AS id FROM jsonb_array_elements_text(${anchorJson}))
        DELETE FROM ai_executions execution
        WHERE execution.organization_id=${job.organization_id}::uuid
          AND EXISTS (SELECT 1 FROM anchors a WHERE COALESCE(execution.input_references::text,'') LIKE '%' || a.id || '%' OR COALESCE(execution.structured_output::text,'') LIKE '%' || a.id || '%')
      `;
      await tx`
        WITH anchors AS (SELECT value AS id FROM jsonb_array_elements_text(${anchorJson}))
        UPDATE automation_runs run
        SET input='{"privacyRedacted":true}'::jsonb,
            output='{"privacyRedacted":true}'::jsonb,
            error_message=NULL
        WHERE run.organization_id=${job.organization_id}::uuid
          AND EXISTS (SELECT 1 FROM anchors a WHERE COALESCE(run.input::text,'') LIKE '%' || a.id || '%' OR COALESCE(run.output::text,'') LIKE '%' || a.id || '%')
      `;
      await tx`
        WITH anchors AS (SELECT value AS id FROM jsonb_array_elements_text(${anchorJson}))
        UPDATE integration_webhook_events event
        SET payload='{"privacyRedacted":true}'::jsonb,
            error_message=NULL
        WHERE event.organization_id=${job.organization_id}::uuid
          AND EXISTS (SELECT 1 FROM anchors a WHERE COALESCE(event.payload::text,'') LIKE '%' || a.id || '%')
      `;
      await tx`
        WITH anchors AS (SELECT value AS id FROM jsonb_array_elements_text(${anchorJson}))
        UPDATE audit_events event
        SET entity_id=CASE WHEN EXISTS (SELECT 1 FROM anchors a WHERE event.entity_id=a.id) THEN NULL ELSE event.entity_id END,
            before=CASE WHEN EXISTS (SELECT 1 FROM anchors a WHERE COALESCE(event.before::text,'') LIKE '%' || a.id || '%') THEN '{"privacyRedacted":true}'::jsonb ELSE event.before END,
            after=CASE WHEN EXISTS (SELECT 1 FROM anchors a WHERE COALESCE(event.after::text,'') LIKE '%' || a.id || '%') THEN '{"privacyRedacted":true}'::jsonb ELSE event.after END,
            metadata=CASE WHEN EXISTS (SELECT 1 FROM anchors a WHERE COALESCE(event.metadata::text,'') LIKE '%' || a.id || '%') THEN '{"privacyRedacted":true}'::jsonb ELSE event.metadata END
        WHERE event.organization_id=${job.organization_id}::uuid
          AND EXISTS (
            SELECT 1 FROM anchors a
            WHERE event.entity_id=a.id
               OR COALESCE(event.before::text,'') LIKE '%' || a.id || '%'
               OR COALESCE(event.after::text,'') LIKE '%' || a.id || '%'
               OR COALESCE(event.metadata::text,'') LIKE '%' || a.id || '%'
          )
      `;

      await tx`
        DELETE FROM candidate_aliases
        WHERE organization_id=${job.organization_id}::uuid
          AND (duplicate_candidate_id=${candidateId}::uuid OR canonical_candidate_id=${candidateId}::uuid)
      `;
      await tx`
        DELETE FROM candidate_duplicate_reviews
        WHERE organization_id=${job.organization_id}::uuid
          AND (duplicate_candidate_id=${candidateId}::uuid OR canonical_candidate_id=${candidateId}::uuid)
      `;
      await tx`
        DELETE FROM discovered_candidates
        WHERE organization_id=${job.organization_id}::uuid AND candidate_id=${candidateId}::uuid
      `;

      const deletedCandidate = await tx`
        DELETE FROM candidates
        WHERE organization_id=${job.organization_id}::uuid AND id=${candidateId}::uuid
        RETURNING id::text
      `;
      if (!deletedCandidate[0]) throw new Error("Candidate deletion did not remove the expected subject row");

      const fileIds = await tx`
        SELECT DISTINCT file_id::text AS id
        FROM privacy_deletion_objects
        WHERE organization_id=${job.organization_id}::uuid
          AND deletion_job_id=${job.id}::uuid
          AND file_id IS NOT NULL
          AND state='deleted'
      `;
      const ids = fileIds.map((row) => String(row.id));
      if (ids.length) {
        await tx`
          WITH ids AS (SELECT value::uuid AS id FROM jsonb_array_elements_text(${tx.json(ids as never)}))
          DELETE FROM files file
          WHERE file.organization_id=${job.organization_id}::uuid
            AND file.id IN (SELECT id FROM ids)
        `;
      }

      const storageStats = await tx`
        SELECT count(*)::int AS object_count, COALESCE(sum(size_bytes),0)::bigint AS storage_bytes
        FROM privacy_deletion_objects
        WHERE organization_id=${job.organization_id}::uuid
          AND deletion_job_id=${job.id}::uuid AND state='deleted'
      `;
      const storageObjectCount = Number(storageStats[0]?.object_count ?? 0);
      const storageBytes = Number(storageStats[0]?.storage_bytes ?? 0);
      const deletedCounts = job.planned_counts ?? {};
      const verification = {
        candidateRowDeleted: true,
        storageObjectsVerifiedAbsent: true,
        sourceCandidateIdRetained: false,
        subjectReference: "sha256(organization:candidate)",
        workerId,
      };
      const receiptRows = await tx`
        INSERT INTO privacy_deletion_receipts (
          organization_id, deletion_job_id, privacy_request_id, subject_digest,
          deleted_counts, storage_object_count, storage_bytes, verification
        ) VALUES (
          ${job.organization_id}::uuid,
          ${job.id}::uuid,
          ${job.privacy_request_id}::uuid,
          ${job.subject_digest},
          ${tx.json(deletedCounts as never)},
          ${storageObjectCount},
          ${storageBytes},
          ${tx.json(verification as never)}
        )
        ON CONFLICT (organization_id, deletion_job_id)
        DO UPDATE SET verification=EXCLUDED.verification
        RETURNING id::text, completed_at
      `;
      const receipt = receiptRows[0];
      if (!receipt) throw new Error("Failed to persist privacy deletion receipt");

      await tx`
        UPDATE privacy_requests
        SET candidate_id=NULL,
            status='completed',
            completed_at=now(),
            subject_digest=${job.subject_digest},
            metadata=(COALESCE(metadata,'{}'::jsonb) - 'candidateId') || ${tx.json({ deletionReceiptId: String(receipt.id) } as never)},
            updated_at=now()
        WHERE organization_id=${job.organization_id}::uuid AND id=${job.privacy_request_id}::uuid
      `;
      await tx`
        UPDATE privacy_deletion_jobs
        SET candidate_id=NULL,
            state='succeeded',
            worker_id=NULL,
            lease_token=NULL,
            lease_expires_at=NULL,
            completed_at=now(),
            updated_at=now()
        WHERE organization_id=${job.organization_id}::uuid AND id=${job.id}::uuid
      `;
      await tx`
        INSERT INTO audit_events (
          organization_id, actor_type, action, entity_type, entity_id, reason, metadata
        ) VALUES (
          ${job.organization_id}::uuid,
          'system',
          'privacy.deletion.completed',
          'privacy_deletion_receipt',
          ${String(receipt.id)},
          'Approved candidate privacy deletion executed',
          ${tx.json({ subjectDigest: job.subject_digest, deletionJobId: job.id, storageObjectCount } as never)}
        )
      `;

      return {
        needsResync: false as const,
        result: {
          jobId: job.id,
          state: "succeeded",
          receiptId: String(receipt.id),
          subjectDigest: job.subject_digest,
          storageObjectCount,
          storageBytes,
          completedAt: iso(receipt.completed_at as Date | string),
        },
      };
    });
  }

  private async block(job: PrivacyDeletionJobRow, errorCode: string, message: string) {
    const rows = await this.database.sql.begin(async (tx) => {
      const updated = await tx`
        UPDATE privacy_deletion_jobs
        SET state='blocked',
            worker_id=NULL,
            lease_token=NULL,
            lease_expires_at=NULL,
            last_error_code=${errorCode},
            last_error=${message.slice(0, 4000)},
            updated_at=now()
        WHERE organization_id=${job.organization_id}::uuid
          AND id=${job.id}::uuid
          AND state='claimed'
        RETURNING id::text
      `;
      if (!updated[0]) throw new ConflictException("Privacy deletion block rejected because the job is no longer claimed");
      await tx`
        UPDATE privacy_requests
        SET status='deletion_blocked', updated_at=now()
        WHERE organization_id=${job.organization_id}::uuid AND id=${job.privacy_request_id}::uuid
      `;
      return updated;
    });
    return { jobId: String(rows[0]?.id), state: "blocked" as const, errorCode, message };
  }

  private mapRequest(row: PrivacyRequestRow | undefined): Record<string, unknown> {
    if (!row) throw new Error("Privacy persistence returned no row");
    const candidateReference = row.candidate_id ?? (row.subject_digest ? `deleted:${row.subject_digest}` : "deleted");
    return {
      id: String(row.id),
      candidateId: candidateReference,
      requestType: String(row.request_type),
      status: String(row.status),
      requestedAt: iso(row.requested_at),
      ...(row.review_notes ? { reviewNotes: String(row.review_notes) } : {}),
      ...(row.completed_at ? { completedAt: iso(row.completed_at) } : {}),
      metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {},
    };
  }
}

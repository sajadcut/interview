import { randomUUID } from "node:crypto";
import { ConflictException, Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { normalizeAssessmentScore } from "./assessment-runner";

const MIN_LEASE_MS = 5_000;
const MAX_LEASE_MS = 300_000;
const DEFAULT_LEASE_MS = 120_000;
const RESULT_STATUSES = new Set(["passed", "failed", "runtime_error", "timeout", "runner_error"]);

interface AssessmentJobRow {
  id: string;
  organization_id: string;
  submission_id: string;
  state: "queued" | "claimed" | "succeeded" | "failed" | "cancelled";
  requested_runner_type: string;
  time_limit_ms: number;
  memory_limit_mb: number;
  network_access: boolean;
  attempt_count: number;
  max_attempts: number;
  available_at: Date | string;
  worker_id: string | null;
  lease_token: string | null;
  lease_expires_at: Date | string | null;
  claimed_at: Date | string | null;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  last_error_code: string | null;
  last_error: string | null;
}

interface AssessmentJobPayloadRow extends AssessmentJobRow {
  assessment_session_id: string;
  language: string | null;
  source_text: string | null;
  runner_policy: Record<string, unknown> | null;
}

export interface AssessmentWorkerResult {
  status: "passed" | "failed" | "runtime_error" | "timeout" | "runner_error";
  passedTests: number;
  totalTests: number;
  rawScore: number;
  runnerType: string;
  runnerVersion: string;
  details: Record<string, unknown>;
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

export function computeAssessmentRetryDelayMs(attemptCount: number): number {
  const attempt = Math.max(1, Math.trunc(attemptCount));
  return Math.min(60_000, 1_000 * 2 ** Math.min(attempt - 1, 6));
}

export function validateAssessmentWorkerResult(value: Record<string, unknown>): AssessmentWorkerResult {
  if (typeof value.status !== "string" || !RESULT_STATUSES.has(value.status)) {
    throw new Error("Unsupported assessment result status");
  }
  if (!Number.isInteger(value.passedTests) || !Number.isInteger(value.totalTests)) {
    throw new Error("Assessment result test counts must be integers");
  }
  const passedTests = Number(value.passedTests);
  const totalTests = Number(value.totalTests);
  normalizeAssessmentScore(passedTests, totalTests);
  if (typeof value.runnerType !== "string" || !value.runnerType.trim()) {
    throw new Error("Assessment runnerType is required");
  }
  if (value.runnerType === "core-api" || value.runnerType === "disabled-core-process") {
    throw new Error("Core API execution is prohibited");
  }
  if (typeof value.runnerVersion !== "string" || !value.runnerVersion.trim()) {
    throw new Error("Assessment runnerVersion is required");
  }
  const details = value.details && typeof value.details === "object" && !Array.isArray(value.details)
    ? (value.details as Record<string, unknown>)
    : {};
  return {
    status: value.status as AssessmentWorkerResult["status"],
    passedTests,
    totalTests,
    rawScore: typeof value.rawScore === "number" && Number.isFinite(value.rawScore) ? value.rawScore : passedTests,
    runnerType: value.runnerType.trim().slice(0, 64),
    runnerVersion: value.runnerVersion.trim().slice(0, 120),
    details,
  };
}

@Injectable()
export class AssessmentWorkerQueueService {
  constructor(private readonly database: DatabaseService) {}

  async claim(workerId: string, requestedLeaseMs?: number) {
    const normalizedWorkerId = workerId.trim();
    if (!normalizedWorkerId) throw new Error("workerId is required");
    const leaseMs = boundedInteger(requestedLeaseMs, DEFAULT_LEASE_MS, MIN_LEASE_MS, MAX_LEASE_MS);
    const leaseToken = randomUUID();

    return this.database.sql.begin(async (tx) => {
      await tx`
        UPDATE assessment_execution_jobs
        SET
          state = CASE WHEN attempt_count >= max_attempts THEN 'failed' ELSE 'queued' END,
          available_at = CASE
            WHEN attempt_count >= max_attempts THEN available_at
            ELSE now() + interval '1 second'
          END,
          worker_id = NULL,
          lease_token = NULL,
          lease_expires_at = NULL,
          last_error_code = 'LEASE_EXPIRED',
          last_error = 'Assessment worker lease expired before completion',
          completed_at = CASE WHEN attempt_count >= max_attempts THEN now() ELSE NULL END,
          updated_at = now()
        WHERE state = 'claimed'
          AND lease_expires_at IS NOT NULL
          AND lease_expires_at <= now()
      `;

      const claimedRows = await tx`
        WITH candidate AS (
          SELECT id
          FROM assessment_execution_jobs
          WHERE state = 'queued'
            AND available_at <= now()
            AND attempt_count < max_attempts
            AND network_access = false
          ORDER BY available_at ASC, created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE assessment_execution_jobs AS job
        SET
          state = 'claimed',
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
        RETURNING job.id::text
      `;
      const claimedId = claimedRows[0]?.id;
      if (!claimedId) return null;

      const payloadRows = await tx`
        SELECT
          job.id::text,
          job.organization_id::text,
          job.submission_id::text,
          job.state,
          job.requested_runner_type,
          job.time_limit_ms,
          job.memory_limit_mb,
          job.network_access,
          job.attempt_count,
          job.max_attempts,
          job.available_at,
          job.worker_id,
          job.lease_token::text,
          job.lease_expires_at,
          job.claimed_at,
          job.started_at,
          job.completed_at,
          job.last_error_code,
          job.last_error,
          sub.assessment_session_id::text,
          sub.language,
          sub.source_text,
          a.runner_policy
        FROM assessment_execution_jobs job
        JOIN assessment_submissions sub
          ON sub.organization_id = job.organization_id AND sub.id = job.submission_id
        JOIN assessment_sessions session
          ON session.organization_id = sub.organization_id AND session.id = sub.assessment_session_id
        JOIN assessments a
          ON a.organization_id = session.organization_id AND a.id = session.assessment_id
        WHERE job.id = ${claimedId}::uuid
        LIMIT 1
      `;
      const row = payloadRows[0] as AssessmentJobPayloadRow | undefined;
      if (!row) throw new Error("Claimed assessment job payload could not be resolved");

      return {
        jobId: row.id,
        submissionId: row.submission_id,
        assessmentSessionId: row.assessment_session_id,
        leaseToken: row.lease_token,
        leaseExpiresAt: row.lease_expires_at ? new Date(row.lease_expires_at).toISOString() : null,
        attemptCount: row.attempt_count,
        maxAttempts: row.max_attempts,
        language: row.language,
        sourceText: row.source_text,
        runnerPolicy: row.runner_policy ?? {},
        timeLimitMs: row.time_limit_ms,
        memoryLimitMb: row.memory_limit_mb,
        networkAccess: false as const,
      };
    });
  }

  async heartbeat(jobId: string, leaseToken: string, workerId: string, requestedLeaseMs?: number) {
    const leaseMs = boundedInteger(requestedLeaseMs, DEFAULT_LEASE_MS, MIN_LEASE_MS, MAX_LEASE_MS);
    const rows = await this.database.sql`
      UPDATE assessment_execution_jobs
      SET lease_expires_at = now() + (${leaseMs} * interval '1 millisecond'), updated_at = now()
      WHERE id = ${jobId}::uuid
        AND state = 'claimed'
        AND lease_token = ${leaseToken}::uuid
        AND worker_id = ${workerId}
        AND lease_expires_at > now()
      RETURNING id::text, state, lease_expires_at
    `;
    const row = rows[0];
    if (!row) throw new ConflictException("Assessment job lease is no longer owned by this worker");
    return {
      jobId: String(row.id),
      state: String(row.state),
      leaseExpiresAt: new Date(String(row.lease_expires_at)).toISOString(),
    };
  }

  async complete(jobId: string, leaseToken: string, workerId: string, rawResult: Record<string, unknown>) {
    const result = validateAssessmentWorkerResult(rawResult);
    return this.database.sql.begin(async (tx) => {
      const jobRows = await tx`
        SELECT job.*, sub.assessment_session_id::text
        FROM assessment_execution_jobs job
        JOIN assessment_submissions sub
          ON sub.organization_id = job.organization_id AND sub.id = job.submission_id
        WHERE job.id = ${jobId}::uuid
          AND job.state = 'claimed'
          AND job.lease_token = ${leaseToken}::uuid
          AND job.worker_id = ${workerId}
          AND job.lease_expires_at > now()
        FOR UPDATE OF job
      `;
      const job = jobRows[0] as (AssessmentJobRow & { assessment_session_id: string }) | undefined;
      if (!job) throw new ConflictException("Assessment job completion rejected because the lease is stale");

      const existingRows = await tx`
        SELECT id::text, status, normalized_score
        FROM assessment_results
        WHERE organization_id = ${job.organization_id}::uuid
          AND submission_id = ${job.submission_id}::uuid
        ORDER BY created_at DESC
        LIMIT 1
      `;

      let resultId: string;
      let normalizedScore: number;
      if (existingRows[0]) {
        resultId = String(existingRows[0].id);
        normalizedScore = Number(existingRows[0].normalized_score ?? 0);
      } else {
        normalizedScore = normalizeAssessmentScore(result.passedTests, result.totalTests);
        const inserted = await tx`
          INSERT INTO assessment_results (
            organization_id,
            assessment_session_id,
            submission_id,
            runner_type,
            runner_version,
            status,
            passed_tests,
            total_tests,
            raw_score,
            normalized_score,
            details
          ) VALUES (
            ${job.organization_id}::uuid,
            ${job.assessment_session_id}::uuid,
            ${job.submission_id}::uuid,
            ${result.runnerType},
            ${result.runnerVersion},
            ${result.status},
            ${result.passedTests},
            ${result.totalTests},
            ${result.rawScore},
            ${normalizedScore},
            ${tx.json({ ...result.details, coreApiExecutedCode: false, workerId } as never)}
          )
          RETURNING id::text
        `;
        resultId = String(inserted[0]?.id);
      }

      await tx`
        UPDATE assessment_sessions
        SET status = 'completed', updated_at = now()
        WHERE organization_id = ${job.organization_id}::uuid
          AND id = ${job.assessment_session_id}::uuid
      `;
      await tx`
        UPDATE assessment_execution_jobs
        SET
          state = 'succeeded',
          external_job_reference = ${resultId},
          worker_id = NULL,
          lease_token = NULL,
          lease_expires_at = NULL,
          completed_at = now(),
          updated_at = now()
        WHERE id = ${jobId}::uuid
      `;

      return { jobId, state: "succeeded" as const, resultId, normalizedScore };
    });
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
        SELECT * FROM assessment_execution_jobs
        WHERE id = ${input.jobId}::uuid
          AND state = 'claimed'
          AND lease_token = ${input.leaseToken}::uuid
          AND worker_id = ${input.workerId}
          AND lease_expires_at > now()
        FOR UPDATE
      `;
      const current = rows[0] as AssessmentJobRow | undefined;
      if (!current) throw new ConflictException("Assessment job failure report rejected because the lease is stale");

      const willRetry = input.retryable && current.attempt_count < current.max_attempts;
      const delayMs = willRetry ? computeAssessmentRetryDelayMs(current.attempt_count) : 0;
      const nextState = willRetry ? "queued" : "failed";
      const updated = await tx`
        UPDATE assessment_execution_jobs
        SET
          state = ${nextState},
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
        RETURNING id::text, state, attempt_count, max_attempts, available_at, completed_at
      `;
      const row = updated[0];
      return {
        jobId: String(row.id),
        state: String(row.state),
        attemptCount: Number(row.attempt_count),
        maxAttempts: Number(row.max_attempts),
        retryDelayMs: delayMs,
      };
    });
  }
}

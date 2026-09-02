import { randomUUID } from "node:crypto";
import { ConflictException, Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";

const MIN_LEASE_MS = 5_000;
const MAX_LEASE_MS = 300_000;
const DEFAULT_LEASE_MS = 120_000;

export type AiJobStatus =
  | "queued"
  | "running"
  | "retry_scheduled"
  | "succeeded"
  | "failed"
  | "dead_letter"
  | "cancelled";

export interface AiJob {
  id: string;
  organizationId: string;
  executionId: string | null;
  capability: string;
  payload: Record<string, unknown>;
  status: AiJobStatus;
  priority: number;
  attemptCount: number;
  maxAttempts: number;
  timeoutMs: number;
  retryBaseMs: number;
  retryMaxMs: number;
  availableAt: string;
  leaseExpiresAt: string | null;
  leaseToken: string | null;
  workerId: string | null;
  idempotencyKey: string | null;
  result: Record<string, unknown> | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface EnqueueAiJobInput {
  organizationId: string;
  executionId?: string;
  capability: string;
  payload?: Record<string, unknown>;
  priority?: number;
  maxAttempts?: number;
  timeoutMs?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  idempotencyKey?: string;
  availableAt?: Date;
}

interface AiJobRow {
  id: string;
  organization_id: string;
  execution_id: string | null;
  capability: string;
  payload: Record<string, unknown> | null;
  status: AiJobStatus;
  priority: number;
  attempt_count: number;
  max_attempts: number;
  timeout_ms: number;
  retry_base_ms: number;
  retry_max_ms: number;
  available_at: Date | string;
  lease_expires_at: Date | string | null;
  lease_token: string | null;
  worker_id: string | null;
  idempotency_key: string | null;
  result: Record<string, unknown> | null;
  last_error_code: string | null;
  last_error_message: string | null;
  created_at: Date | string;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  updated_at: Date | string;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toJob(row: AiJobRow): AiJob {
  return {
    id: row.id,
    organizationId: row.organization_id,
    executionId: row.execution_id,
    capability: row.capability,
    payload: row.payload ?? {},
    status: row.status,
    priority: row.priority,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    timeoutMs: row.timeout_ms,
    retryBaseMs: row.retry_base_ms,
    retryMaxMs: row.retry_max_ms,
    availableAt: iso(row.available_at)!,
    leaseExpiresAt: iso(row.lease_expires_at),
    leaseToken: row.lease_token,
    workerId: row.worker_id,
    idempotencyKey: row.idempotency_key,
    result: row.result,
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    createdAt: iso(row.created_at)!,
    startedAt: iso(row.started_at),
    completedAt: iso(row.completed_at),
    updatedAt: iso(row.updated_at)!,
  };
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

export function computeRetryDelayMs(
  attemptCount: number,
  retryBaseMs: number,
  retryMaxMs: number,
): number {
  const attempt = Math.max(1, Math.trunc(attemptCount));
  const base = Math.max(100, Math.trunc(retryBaseMs));
  const ceiling = Math.max(base, Math.trunc(retryMaxMs));
  return Math.min(ceiling, base * 2 ** Math.min(attempt - 1, 20));
}

@Injectable()
export class AiJobQueueService {
  constructor(private readonly database: DatabaseService) {}

  async enqueue(input: EnqueueAiJobInput): Promise<AiJob> {
    const id = randomUUID();
    const capability = input.capability.trim();
    if (!capability) throw new Error("AI job capability is required");

    const priority = boundedInteger(input.priority, 100, 0, 1000);
    const maxAttempts = boundedInteger(input.maxAttempts, 3, 1, 10);
    const timeoutMs = boundedInteger(input.timeoutMs, 30_000, 250, 300_000);
    const retryBaseMs = boundedInteger(input.retryBaseMs, 1_000, 100, 60_000);
    const retryMaxMs = Math.max(
      retryBaseMs,
      boundedInteger(input.retryMaxMs, 60_000, 100, 600_000),
    );
    const idempotencyKey = input.idempotencyKey?.trim() || null;
    const availableAt = input.availableAt ?? new Date();

    let inserted = true;
    let rows = await this.database.sql`
      INSERT INTO ai_jobs (
        id, organization_id, execution_id, capability, payload, priority,
        max_attempts, timeout_ms, retry_base_ms, retry_max_ms,
        idempotency_key, available_at
      ) VALUES (
        ${id}::uuid,
        ${input.organizationId}::uuid,
        ${input.executionId ?? null}::uuid,
        ${capability},
        ${this.database.sql.json((input.payload ?? {}) as never)},
        ${priority},
        ${maxAttempts},
        ${timeoutMs},
        ${retryBaseMs},
        ${retryMaxMs},
        ${idempotencyKey},
        ${availableAt}
      )
      ON CONFLICT (organization_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL
      DO NOTHING
      RETURNING *
    `;

    if (!rows.length && idempotencyKey) {
      inserted = false;
      rows = await this.database.sql`
        SELECT * FROM ai_jobs
        WHERE organization_id = ${input.organizationId}::uuid
          AND idempotency_key = ${idempotencyKey}
        LIMIT 1
      `;
    }

    const row = rows[0] as AiJobRow | undefined;
    if (!row) throw new Error("Failed to enqueue or resolve idempotent AI job");

    if (inserted) {
      await this.appendEvent(row.organization_id, row.id, "enqueued", 0, null, {
        capability,
        priority,
      });
    }

    return toJob(row);
  }

  async claim(workerId: string, requestedLeaseMs?: number): Promise<AiJob | null> {
    const normalizedWorkerId = workerId.trim();
    if (!normalizedWorkerId) throw new Error("workerId is required");
    const leaseMs = boundedInteger(requestedLeaseMs, DEFAULT_LEASE_MS, MIN_LEASE_MS, MAX_LEASE_MS);
    const leaseToken = randomUUID();

    return this.database.sql.begin(async (tx) => {
      const expired = await tx`
        UPDATE ai_jobs
        SET
          status = CASE WHEN attempt_count >= max_attempts THEN 'dead_letter' ELSE 'retry_scheduled' END,
          available_at = CASE
            WHEN attempt_count >= max_attempts THEN available_at
            ELSE now() + (LEAST(retry_max_ms, retry_base_ms * power(2, LEAST(GREATEST(attempt_count - 1, 0), 20))) * interval '1 millisecond')
          END,
          lease_expires_at = NULL,
          lease_token = NULL,
          worker_id = NULL,
          last_error_code = 'LEASE_EXPIRED',
          last_error_message = 'Worker lease expired before completion',
          completed_at = CASE WHEN attempt_count >= max_attempts THEN now() ELSE NULL END,
          updated_at = now()
        WHERE status = 'running'
          AND lease_expires_at IS NOT NULL
          AND lease_expires_at <= now()
        RETURNING organization_id, id, attempt_count, status
      `;

      for (const expiredRow of expired as unknown as Array<{
        organization_id: string;
        id: string;
        attempt_count: number;
        status: AiJobStatus;
      }>) {
        await tx`
          INSERT INTO ai_job_events (organization_id, ai_job_id, event_type, attempt, details)
          VALUES (
            ${expiredRow.organization_id}::uuid,
            ${expiredRow.id}::uuid,
            ${expiredRow.status === "dead_letter" ? "dead_lettered" : "lease_expired"},
            ${expiredRow.attempt_count},
            ${tx.json({ errorCode: "LEASE_EXPIRED" } as never)}
          )
        `;
      }

      const rows = await tx`
        WITH candidate AS (
          SELECT id
          FROM ai_jobs
          WHERE status IN ('queued', 'retry_scheduled')
            AND available_at <= now()
            AND attempt_count < max_attempts
          ORDER BY priority ASC, available_at ASC, created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE ai_jobs AS job
        SET
          status = 'running',
          attempt_count = job.attempt_count + 1,
          worker_id = ${normalizedWorkerId},
          lease_token = ${leaseToken}::uuid,
          lease_expires_at = now() + (${leaseMs} * interval '1 millisecond'),
          started_at = COALESCE(job.started_at, now()),
          last_error_code = NULL,
          last_error_message = NULL,
          updated_at = now()
        FROM candidate
        WHERE job.id = candidate.id
        RETURNING job.*
      `;

      const row = rows[0] as AiJobRow | undefined;
      if (!row) return null;

      await tx`
        INSERT INTO ai_job_events (organization_id, ai_job_id, event_type, attempt, worker_id, details)
        VALUES (
          ${row.organization_id}::uuid,
          ${row.id}::uuid,
          'claimed',
          ${row.attempt_count},
          ${normalizedWorkerId},
          ${tx.json({ leaseMs } as never)}
        )
      `;
      return toJob(row);
    });
  }

  async heartbeat(jobId: string, leaseToken: string, workerId: string, requestedLeaseMs?: number): Promise<AiJob> {
    const leaseMs = boundedInteger(requestedLeaseMs, DEFAULT_LEASE_MS, MIN_LEASE_MS, MAX_LEASE_MS);
    const rows = await this.database.sql`
      UPDATE ai_jobs
      SET lease_expires_at = now() + (${leaseMs} * interval '1 millisecond'), updated_at = now()
      WHERE id = ${jobId}::uuid
        AND status = 'running'
        AND lease_token = ${leaseToken}::uuid
        AND worker_id = ${workerId}
        AND lease_expires_at > now()
      RETURNING *
    `;
    const row = rows[0] as AiJobRow | undefined;
    if (!row) throw new ConflictException("AI job lease is no longer owned by this worker");
    return toJob(row);
  }

  async complete(
    jobId: string,
    leaseToken: string,
    workerId: string,
    result: Record<string, unknown>,
  ): Promise<AiJob> {
    return this.database.sql.begin(async (tx) => {
      const rows = await tx`
        UPDATE ai_jobs
        SET
          status = 'succeeded',
          result = ${tx.json(result as never)},
          lease_expires_at = NULL,
          lease_token = NULL,
          completed_at = now(),
          updated_at = now()
        WHERE id = ${jobId}::uuid
          AND status = 'running'
          AND lease_token = ${leaseToken}::uuid
          AND worker_id = ${workerId}
          AND lease_expires_at > now()
        RETURNING *
      `;
      const row = rows[0] as AiJobRow | undefined;
      if (!row) throw new ConflictException("AI job completion rejected because the lease is stale");
      await tx`
        INSERT INTO ai_job_events (organization_id, ai_job_id, event_type, attempt, worker_id)
        VALUES (${row.organization_id}::uuid, ${row.id}::uuid, 'succeeded', ${row.attempt_count}, ${workerId})
      `;
      return toJob(row);
    });
  }

  async fail(input: {
    jobId: string;
    leaseToken: string;
    workerId: string;
    retryable: boolean;
    errorCode: string;
    errorMessage: string;
  }): Promise<AiJob> {
    return this.database.sql.begin(async (tx) => {
      const currentRows = await tx`
        SELECT * FROM ai_jobs
        WHERE id = ${input.jobId}::uuid
          AND status = 'running'
          AND lease_token = ${input.leaseToken}::uuid
          AND worker_id = ${input.workerId}
          AND lease_expires_at > now()
        FOR UPDATE
      `;
      const current = currentRows[0] as AiJobRow | undefined;
      if (!current) throw new ConflictException("AI job failure report rejected because the lease is stale");

      const willRetry = input.retryable && current.attempt_count < current.max_attempts;
      const nextStatus: AiJobStatus = willRetry ? "retry_scheduled" : "dead_letter";
      const delayMs = willRetry
        ? computeRetryDelayMs(current.attempt_count, current.retry_base_ms, current.retry_max_ms)
        : 0;

      const rows = await tx`
        UPDATE ai_jobs
        SET
          status = ${nextStatus},
          available_at = CASE
            WHEN ${willRetry} THEN now() + (${delayMs} * interval '1 millisecond')
            ELSE available_at
          END,
          lease_expires_at = NULL,
          lease_token = NULL,
          worker_id = NULL,
          last_error_code = ${input.errorCode.slice(0, 120)},
          last_error_message = ${input.errorMessage.slice(0, 4000)},
          completed_at = CASE WHEN ${willRetry} THEN NULL ELSE now() END,
          updated_at = now()
        WHERE id = ${input.jobId}::uuid
        RETURNING *
      `;
      const row = rows[0] as AiJobRow;
      await tx`
        INSERT INTO ai_job_events (organization_id, ai_job_id, event_type, attempt, worker_id, details)
        VALUES (
          ${row.organization_id}::uuid,
          ${row.id}::uuid,
          ${willRetry ? "retry_scheduled" : "dead_lettered"},
          ${row.attempt_count},
          ${input.workerId},
          ${tx.json({
            retryable: input.retryable,
            delayMs,
            errorCode: input.errorCode.slice(0, 120),
            errorMessage: input.errorMessage.slice(0, 4000),
          } as never)}
        )
      `;
      return toJob(row);
    });
  }

  private async appendEvent(
    organizationId: string,
    jobId: string,
    eventType: string,
    attempt: number,
    workerId: string | null,
    details: Record<string, unknown>,
  ): Promise<void> {
    await this.database.sql`
      INSERT INTO ai_job_events (organization_id, ai_job_id, event_type, attempt, worker_id, details)
      VALUES (
        ${organizationId}::uuid,
        ${jobId}::uuid,
        ${eventType},
        ${attempt},
        ${workerId},
        ${this.database.sql.json(details as never)}
      )
    `;
  }
}

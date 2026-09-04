import { randomUUID } from "node:crypto";
import { ConflictException, Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import {
  isSupportedRetentionEntityType,
  type SupportedRetentionEntityType,
} from "../privacy/retention-policy";

const DEFAULT_LEASE_MS = 120_000;
const MIN_LEASE_MS = 5_000;
const MAX_LEASE_MS = 300_000;

interface RetentionJobRow {
  id: string;
  organization_id: string;
  cycle_key: string;
  state: "queued" | "claimed" | "retry_scheduled" | "succeeded" | "failed";
  dry_run: boolean;
  attempt_count: number;
  max_attempts: number;
  lease_token: string | null;
  lease_expires_at: Date | string | null;
  worker_id: string | null;
  policy_snapshot: unknown;
  created_at: Date | string;
}

interface PolicySnapshot {
  entityType: SupportedRetentionEntityType;
  retentionDays: number;
  legalHoldRules: Record<string, unknown>;
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function retryDelayMs(attemptCount: number): number {
  const attempt = Math.max(1, Math.trunc(attemptCount));
  return Math.min(60_000, 1_000 * 2 ** Math.min(attempt - 1, 6));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parsePolicySnapshot(value: unknown): PolicySnapshot[] {
  if (!Array.isArray(value)) return [];
  const policies: PolicySnapshot[] = [];
  for (const item of value) {
    const record = asRecord(item);
    const entityType = typeof record.entityType === "string" ? record.entityType : "";
    const retentionDays = Number(record.retentionDays);
    if (!isSupportedRetentionEntityType(entityType)) continue;
    if (!Number.isInteger(retentionDays) || retentionDays <= 0) continue;
    policies.push({
      entityType,
      retentionDays,
      legalHoldRules: asRecord(record.legalHoldRules),
    });
  }
  return policies;
}

@Injectable()
export class RetentionQueueService {
  constructor(private readonly database: DatabaseService) {}

  async schedule(cycleKey: string, dryRun = true) {
    const normalizedCycle = cycleKey.trim();
    if (!/^[A-Za-z0-9:_-]{4,120}$/.test(normalizedCycle)) {
      throw new Error("cycleKey must be 4-120 safe characters");
    }

    const rows = await this.database.sql`
      WITH policy_sets AS (
        SELECT
          organization_id,
          jsonb_agg(
            jsonb_build_object(
              'entityType', entity_type,
              'retentionDays', retention_days,
              'legalHoldRules', legal_hold_rules
            )
            ORDER BY entity_type
          ) AS policy_snapshot
        FROM retention_policies
        WHERE enabled = true
          AND entity_type IN (
            'candidates',
            'ai_executions',
            'recruitment_events',
            'interview_media_events'
          )
        GROUP BY organization_id
      ),
      inserted AS (
        INSERT INTO retention_jobs (
          organization_id, cycle_key, dry_run, policy_snapshot
        )
        SELECT organization_id, ${normalizedCycle}, ${dryRun}, policy_snapshot
        FROM policy_sets
        ON CONFLICT (organization_id, cycle_key) DO NOTHING
        RETURNING id
      )
      SELECT count(*)::int AS scheduled_count FROM inserted
    `;
    return {
      cycleKey: normalizedCycle,
      dryRun,
      scheduledCount: Number(rows[0]?.scheduled_count ?? 0),
    };
  }

  async claim(workerId: string, requestedLeaseMs?: number) {
    const normalizedWorker = workerId.trim();
    if (!normalizedWorker) throw new Error("workerId is required");
    const leaseMs = boundedInteger(requestedLeaseMs, DEFAULT_LEASE_MS, MIN_LEASE_MS, MAX_LEASE_MS);
    const leaseToken = randomUUID();

    return this.database.sql.begin(async (tx) => {
      await tx`
        UPDATE retention_jobs
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
          last_error = 'Retention worker lease expired before completion',
          completed_at = CASE WHEN attempt_count >= max_attempts THEN now() ELSE NULL END,
          updated_at = now()
        WHERE state = 'claimed'
          AND lease_expires_at IS NOT NULL
          AND lease_expires_at <= now()
      `;

      const rows = await tx`
        WITH candidate AS (
          SELECT id
          FROM retention_jobs
          WHERE state IN ('queued', 'retry_scheduled')
            AND available_at <= now()
            AND attempt_count < max_attempts
          ORDER BY available_at ASC, created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE retention_jobs AS job
        SET state = 'claimed',
            attempt_count = job.attempt_count + 1,
            worker_id = ${normalizedWorker},
            lease_token = ${leaseToken}::uuid,
            lease_expires_at = now() + (${leaseMs} * interval '1 millisecond'),
            started_at = COALESCE(job.started_at, now()),
            last_error_code = NULL,
            last_error = NULL,
            updated_at = now()
        FROM candidate
        WHERE job.id = candidate.id
        RETURNING job.*
      `;
      const row = rows[0] as RetentionJobRow | undefined;
      if (!row) return null;
      return {
        jobId: row.id,
        organizationId: row.organization_id,
        cycleKey: row.cycle_key,
        dryRun: row.dry_run,
        leaseToken: row.lease_token,
        leaseExpiresAt: new Date(String(row.lease_expires_at)).toISOString(),
        attemptCount: row.attempt_count,
        maxAttempts: row.max_attempts,
      };
    });
  }

  async heartbeat(jobId: string, leaseToken: string, workerId: string, requestedLeaseMs?: number) {
    const leaseMs = boundedInteger(requestedLeaseMs, DEFAULT_LEASE_MS, MIN_LEASE_MS, MAX_LEASE_MS);
    const rows = await this.database.sql`
      UPDATE retention_jobs
      SET lease_expires_at = now() + (${leaseMs} * interval '1 millisecond'),
          updated_at = now()
      WHERE id = ${jobId}::uuid
        AND state = 'claimed'
        AND lease_token = ${leaseToken}::uuid
        AND worker_id = ${workerId}
        AND lease_expires_at > now()
      RETURNING id::text, lease_expires_at
    `;
    if (!rows[0]) throw new ConflictException("Retention job lease is stale");
    return {
      jobId: String(rows[0].id),
      leaseExpiresAt: new Date(String(rows[0].lease_expires_at)).toISOString(),
    };
  }

  async execute(jobId: string, leaseToken: string, workerId: string) {
    const job = await this.requireOwnedJob(jobId, leaseToken, workerId);
    const policies = parsePolicySnapshot(job.policy_snapshot);
    const result: Record<string, unknown> = {};

    for (const policy of policies) {
      const cutoff = new Date(
        new Date(String(job.created_at)).getTime() - policy.retentionDays * 24 * 60 * 60 * 1000,
      );
      const rules = policy.legalHoldRules;
      if (rules.blockDeletion === true) {
        const item = {
          status: "held" as const,
          retentionDays: policy.retentionDays,
          eligible: 0,
          deleted: 0,
          held: 0,
          delegated: 0,
        };
        await this.recordItem(job, policy.entityType, cutoff, item);
        result[policy.entityType] = item;
        continue;
      }

      const item =
        policy.entityType === "candidates"
          ? await this.processCandidates(job, cutoff)
          : await this.processOperational(job, policy.entityType, cutoff);
      await this.recordItem(job, policy.entityType, cutoff, item);
      result[policy.entityType] = {
        ...item,
        retentionDays: policy.retentionDays,
      };
    }

    const rows = await this.database.sql`
      UPDATE retention_jobs
      SET state = 'succeeded',
          result = ${this.database.sql.json(result as never)},
          worker_id = NULL,
          lease_token = NULL,
          lease_expires_at = NULL,
          completed_at = now(),
          updated_at = now()
      WHERE id = ${job.id}::uuid
        AND state = 'claimed'
        AND lease_token = ${leaseToken}::uuid
        AND worker_id = ${workerId}
        AND lease_expires_at > now()
      RETURNING id::text
    `;
    if (!rows[0]) throw new ConflictException("Retention job lease expired before completion");
    return { jobId: job.id, state: "succeeded" as const, dryRun: job.dry_run, result };
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
        SELECT *
        FROM retention_jobs
        WHERE id = ${input.jobId}::uuid
          AND state = 'claimed'
          AND lease_token = ${input.leaseToken}::uuid
          AND worker_id = ${input.workerId}
          AND lease_expires_at > now()
        LIMIT 1
        FOR UPDATE
      `;
      const current = rows[0] as RetentionJobRow | undefined;
      if (!current) throw new ConflictException("Retention failure report rejected because the lease is stale");
      const willRetry = input.retryable && current.attempt_count < current.max_attempts;
      const delayMs = willRetry ? retryDelayMs(current.attempt_count) : 0;
      const nextState = willRetry ? "retry_scheduled" : "failed";
      const updated = await tx`
        UPDATE retention_jobs
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
        RETURNING id::text, state, attempt_count, max_attempts
      `;
      return {
        jobId: String(updated[0]?.id),
        state: String(updated[0]?.state),
        attemptCount: Number(updated[0]?.attempt_count),
        maxAttempts: Number(updated[0]?.max_attempts),
        retryDelayMs: delayMs,
      };
    });
  }

  private async requireOwnedJob(jobId: string, leaseToken: string, workerId: string): Promise<RetentionJobRow> {
    const rows = await this.database.sql`
      SELECT *
      FROM retention_jobs
      WHERE id = ${jobId}::uuid
        AND state = 'claimed'
        AND lease_token = ${leaseToken}::uuid
        AND worker_id = ${workerId}
        AND lease_expires_at > now()
      LIMIT 1
    `;
    const row = rows[0] as RetentionJobRow | undefined;
    if (!row) throw new ConflictException("Retention job lease is stale");
    return row;
  }

  private async processOperational(
    job: RetentionJobRow,
    entityType: Exclude<SupportedRetentionEntityType, "candidates">,
    cutoff: Date,
  ) {
    const counts = await this.operationalCounts(job.organization_id, entityType, cutoff);
    let deleted = 0;
    if (!job.dry_run && counts.eligible > 0) {
      deleted = await this.operationalDelete(job.organization_id, entityType, cutoff);
    }
    return {
      status: job.dry_run ? ("preview" as const) : ("executed" as const),
      eligible: counts.eligible,
      deleted,
      held: counts.held,
      delegated: 0,
    };
  }

  private async operationalCounts(
    organizationId: string,
    entityType: Exclude<SupportedRetentionEntityType, "candidates">,
    cutoff: Date,
  ): Promise<{ eligible: number; held: number }> {
    if (entityType === "ai_executions") {
      const rows = await this.database.sql`
        SELECT
          count(*) FILTER (
            WHERE NOT EXISTS (
              SELECT 1 FROM legal_holds hold
              WHERE hold.organization_id = execution.organization_id
                AND hold.status = 'active'
                AND hold.entity_type = 'ai_execution'
                AND hold.entity_id = execution.id
            )
          )::int AS eligible,
          count(*) FILTER (
            WHERE EXISTS (
              SELECT 1 FROM legal_holds hold
              WHERE hold.organization_id = execution.organization_id
                AND hold.status = 'active'
                AND hold.entity_type = 'ai_execution'
                AND hold.entity_id = execution.id
            )
          )::int AS held
        FROM ai_executions execution
        WHERE execution.organization_id = ${organizationId}::uuid
          AND execution.created_at < ${cutoff}
      `;
      return { eligible: Number(rows[0]?.eligible ?? 0), held: Number(rows[0]?.held ?? 0) };
    }

    if (entityType === "recruitment_events") {
      const rows = await this.database.sql`
        SELECT
          count(*) FILTER (WHERE NOT (
            EXISTS (
              SELECT 1 FROM legal_holds hold
              WHERE hold.organization_id = event.organization_id
                AND hold.status = 'active'
                AND (
                  (hold.entity_type = 'recruitment_event' AND hold.entity_id = event.id)
                  OR (event.candidate_id IS NOT NULL AND (
                    hold.candidate_id = event.candidate_id
                    OR (hold.entity_type = 'candidate' AND hold.entity_id = event.candidate_id)
                  ))
                )
            )
          ))::int AS eligible,
          count(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM legal_holds hold
            WHERE hold.organization_id = event.organization_id
              AND hold.status = 'active'
              AND (
                (hold.entity_type = 'recruitment_event' AND hold.entity_id = event.id)
                OR (event.candidate_id IS NOT NULL AND (
                  hold.candidate_id = event.candidate_id
                  OR (hold.entity_type = 'candidate' AND hold.entity_id = event.candidate_id)
                ))
              )
          ))::int AS held
        FROM recruitment_events event
        WHERE event.organization_id = ${organizationId}::uuid
          AND event.occurred_at < ${cutoff}
      `;
      return { eligible: Number(rows[0]?.eligible ?? 0), held: Number(rows[0]?.held ?? 0) };
    }

    const rows = await this.database.sql`
      SELECT
        count(*) FILTER (WHERE NOT EXISTS (
          SELECT 1
          FROM legal_holds hold
          LEFT JOIN interview_media_sessions media
            ON media.organization_id = event.organization_id
           AND media.id = event.media_session_id
          LEFT JOIN interview_sessions session
            ON session.organization_id = media.organization_id
           AND session.id = media.interview_session_id
          LEFT JOIN applications application
            ON application.organization_id = session.organization_id
           AND application.id = session.application_id
          WHERE hold.organization_id = event.organization_id
            AND hold.status = 'active'
            AND (
              (hold.entity_type = 'interview_media_event' AND hold.entity_id = event.id)
              OR (hold.entity_type = 'interview_session' AND hold.entity_id = session.id)
              OR (hold.entity_type = 'application' AND hold.entity_id = application.id)
              OR hold.candidate_id = application.candidate_id
              OR (hold.entity_type = 'candidate' AND hold.entity_id = application.candidate_id)
            )
        ))::int AS eligible,
        count(*) FILTER (WHERE EXISTS (
          SELECT 1
          FROM legal_holds hold
          LEFT JOIN interview_media_sessions media
            ON media.organization_id = event.organization_id
           AND media.id = event.media_session_id
          LEFT JOIN interview_sessions session
            ON session.organization_id = media.organization_id
           AND session.id = media.interview_session_id
          LEFT JOIN applications application
            ON application.organization_id = session.organization_id
           AND application.id = session.application_id
          WHERE hold.organization_id = event.organization_id
            AND hold.status = 'active'
            AND (
              (hold.entity_type = 'interview_media_event' AND hold.entity_id = event.id)
              OR (hold.entity_type = 'interview_session' AND hold.entity_id = session.id)
              OR (hold.entity_type = 'application' AND hold.entity_id = application.id)
              OR hold.candidate_id = application.candidate_id
              OR (hold.entity_type = 'candidate' AND hold.entity_id = application.candidate_id)
            )
        ))::int AS held
      FROM interview_media_events event
      WHERE event.organization_id = ${organizationId}::uuid
        AND event.occurred_at < ${cutoff}
    `;
    return { eligible: Number(rows[0]?.eligible ?? 0), held: Number(rows[0]?.held ?? 0) };
  }

  private async operationalDelete(
    organizationId: string,
    entityType: Exclude<SupportedRetentionEntityType, "candidates">,
    cutoff: Date,
  ): Promise<number> {
    if (entityType === "ai_executions") {
      const rows = await this.database.sql`
        DELETE FROM ai_executions execution
        WHERE execution.organization_id = ${organizationId}::uuid
          AND execution.created_at < ${cutoff}
          AND NOT EXISTS (
            SELECT 1 FROM legal_holds hold
            WHERE hold.organization_id = execution.organization_id
              AND hold.status = 'active'
              AND hold.entity_type = 'ai_execution'
              AND hold.entity_id = execution.id
          )
        RETURNING id
      `;
      return rows.length;
    }
    if (entityType === "recruitment_events") {
      const rows = await this.database.sql`
        DELETE FROM recruitment_events event
        WHERE event.organization_id = ${organizationId}::uuid
          AND event.occurred_at < ${cutoff}
          AND NOT EXISTS (
            SELECT 1 FROM legal_holds hold
            WHERE hold.organization_id = event.organization_id
              AND hold.status = 'active'
              AND (
                (hold.entity_type = 'recruitment_event' AND hold.entity_id = event.id)
                OR (event.candidate_id IS NOT NULL AND (
                  hold.candidate_id = event.candidate_id
                  OR (hold.entity_type = 'candidate' AND hold.entity_id = event.candidate_id)
                ))
              )
          )
        RETURNING id
      `;
      return rows.length;
    }
    const rows = await this.database.sql`
      DELETE FROM interview_media_events event
      WHERE event.organization_id = ${organizationId}::uuid
        AND event.occurred_at < ${cutoff}
        AND NOT EXISTS (
          SELECT 1
          FROM legal_holds hold
          LEFT JOIN interview_media_sessions media
            ON media.organization_id = event.organization_id
           AND media.id = event.media_session_id
          LEFT JOIN interview_sessions session
            ON session.organization_id = media.organization_id
           AND session.id = media.interview_session_id
          LEFT JOIN applications application
            ON application.organization_id = session.organization_id
           AND application.id = session.application_id
          WHERE hold.organization_id = event.organization_id
            AND hold.status = 'active'
            AND (
              (hold.entity_type = 'interview_media_event' AND hold.entity_id = event.id)
              OR (hold.entity_type = 'interview_session' AND hold.entity_id = session.id)
              OR (hold.entity_type = 'application' AND hold.entity_id = application.id)
              OR hold.candidate_id = application.candidate_id
              OR (hold.entity_type = 'candidate' AND hold.entity_id = application.candidate_id)
            )
        )
      RETURNING id
    `;
    return rows.length;
  }

  private async processCandidates(job: RetentionJobRow, cutoff: Date) {
    const counts = await this.candidateCounts(job.organization_id, cutoff);
    let delegated = 0;
    if (!job.dry_run && counts.eligible > 0) {
      delegated = await this.delegateCandidateDeletion(job, cutoff);
    }
    return {
      status: job.dry_run ? ("preview" as const) : ("executed" as const),
      eligible: counts.eligible,
      deleted: 0,
      held: counts.held,
      delegated,
    };
  }

  private async candidateCounts(organizationId: string, cutoff: Date) {
    const rows = await this.database.sql`
      SELECT
        count(*) FILTER (
          WHERE retention_candidate_is_inactive(candidate.organization_id, candidate.id, ${cutoff})
            AND NOT retention_candidate_is_held(candidate.organization_id, candidate.id)
        )::int AS eligible,
        count(*) FILTER (
          WHERE retention_candidate_is_inactive(candidate.organization_id, candidate.id, ${cutoff})
            AND retention_candidate_is_held(candidate.organization_id, candidate.id)
        )::int AS held
      FROM candidates candidate
      WHERE candidate.organization_id = ${organizationId}::uuid
        AND candidate.created_at < ${cutoff}
    `;
    return {
      eligible: Number(rows[0]?.eligible ?? 0),
      held: Number(rows[0]?.held ?? 0),
    };
  }

  private async delegateCandidateDeletion(job: RetentionJobRow, cutoff: Date): Promise<number> {
    return this.database.sql.begin(async (tx) => {
      const candidates = await tx`
        SELECT candidate.id::text
        FROM candidates candidate
        WHERE candidate.organization_id = ${job.organization_id}::uuid
          AND candidate.created_at < ${cutoff}
          AND retention_candidate_is_inactive(candidate.organization_id, candidate.id, ${cutoff})
          AND NOT retention_candidate_is_held(candidate.organization_id, candidate.id)
        ORDER BY candidate.created_at ASC, candidate.id ASC
      `;

      for (const row of candidates) {
        const candidateId = String(row.id);
        const links = await tx`
          INSERT INTO retention_candidate_deletions (
            organization_id, retention_job_id, candidate_id
          ) VALUES (
            ${job.organization_id}::uuid, ${job.id}::uuid, ${candidateId}::uuid
          )
          ON CONFLICT (organization_id, retention_job_id, candidate_id)
          DO UPDATE SET updated_at = retention_candidate_deletions.updated_at
          RETURNING id::text, privacy_request_id::text
        `;
        const link = links[0];
        if (!link || link.privacy_request_id) continue;

        const subjectDigest = String(
          (
            await tx`
              SELECT encode(
                digest(${`${job.organization_id}:${candidateId}`}, 'sha256'),
                'hex'
              ) AS value
            `
          )[0]?.value ?? "",
        );
        if (!subjectDigest) throw new Error("Failed to derive retention subject digest");

        const requests = await tx`
          INSERT INTO privacy_requests (
            organization_id, candidate_id, request_type, status,
            review_notes, metadata, subject_digest
          ) VALUES (
            ${job.organization_id}::uuid,
            ${candidateId}::uuid,
            'deletion',
            'approved_pending_execution',
            'Automatically approved by the configured retention policy',
            ${tx.json({
              source: "retention",
              retentionJobId: job.id,
              cycleKey: job.cycle_key,
            } as never)},
            ${subjectDigest}
          )
          RETURNING id::text
        `;
        const privacyRequestId = String(requests[0]?.id ?? "");
        if (!privacyRequestId) throw new Error("Failed to create retention privacy request");

        await tx`
          UPDATE retention_candidate_deletions
          SET privacy_request_id = ${privacyRequestId}::uuid, updated_at = now()
          WHERE organization_id = ${job.organization_id}::uuid
            AND id = ${String(link.id)}::uuid
        `;

        await tx`
          INSERT INTO privacy_deletion_jobs (
            organization_id, privacy_request_id, candidate_id, subject_digest
          ) VALUES (
            ${job.organization_id}::uuid,
            ${privacyRequestId}::uuid,
            ${candidateId}::uuid,
            ${subjectDigest}
          )
          ON CONFLICT (organization_id, privacy_request_id) DO NOTHING
        `;
      }
      const delegatedRows = await tx`
        SELECT count(*)::int AS count
        FROM retention_candidate_deletions
        WHERE organization_id = ${job.organization_id}::uuid
          AND retention_job_id = ${job.id}::uuid
          AND privacy_request_id IS NOT NULL
      `;
      return Number(delegatedRows[0]?.count ?? 0);
    });
  }

  private async recordItem(
    job: RetentionJobRow,
    entityType: SupportedRetentionEntityType,
    cutoff: Date,
    item: {
      status: "preview" | "executed" | "held";
      eligible: number;
      deleted: number;
      held: number;
      delegated: number;
    },
  ) {
    await this.database.sql`
      INSERT INTO retention_job_items (
        organization_id, retention_job_id, entity_type, cutoff_at, status,
        eligible_count, deleted_count, held_count, delegated_count, details
      ) VALUES (
        ${job.organization_id}::uuid,
        ${job.id}::uuid,
        ${entityType},
        ${cutoff},
        ${item.status},
        ${item.eligible},
        ${item.deleted},
        ${item.held},
        ${item.delegated},
        ${this.database.sql.json({ dryRun: job.dry_run } as never)}
      )
      ON CONFLICT (organization_id, retention_job_id, entity_type)
      DO UPDATE SET
        cutoff_at = EXCLUDED.cutoff_at,
        status = EXCLUDED.status,
        eligible_count = EXCLUDED.eligible_count,
        deleted_count = EXCLUDED.deleted_count,
        held_count = EXCLUDED.held_count,
        delegated_count = EXCLUDED.delegated_count,
        details = EXCLUDED.details,
        updated_at = now()
    `;
  }
}

export { retryDelayMs as computeRetentionRetryDelayMs };

import { createHash } from "node:crypto";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AuthContextService } from "../auth/auth-context.service";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import type {
  LegalHoldInputDto,
  MaintenanceExecutionDto,
  SessionCleanupRequestDto,
} from "./maintenance.dto";

type MaintenanceJobType = "retention" | "privacy_deletion" | "session_cleanup";

function actorId(auth: AuthContextService): string {
  const userId = auth.getOptional()?.userId;
  if (!userId) throw new BadRequestException("Authenticated user context is required");
  return userId;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

@Injectable()
export class MaintenanceService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
    private readonly authContext: AuthContextService,
  ) {}

  private async existingJob(
    organizationId: string,
    type: MaintenanceJobType,
    idempotencyKey: string | undefined,
  ) {
    if (!idempotencyKey) return null;
    const rows = await this.database.sql`
      SELECT id::text, job_type, state, dry_run, result, error_message, started_at, completed_at
      FROM maintenance_jobs
      WHERE organization_id = ${organizationId}::uuid
        AND job_type = ${type}
        AND idempotency_key = ${idempotencyKey}
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  private async startJob(
    organizationId: string,
    userId: string,
    type: MaintenanceJobType,
    dryRun: boolean,
    input: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<string> {
    const rows = await this.database.sql`
      INSERT INTO maintenance_jobs (
        organization_id, job_type, idempotency_key, state, dry_run,
        input, requested_by_user_id, started_at
      ) VALUES (
        ${organizationId}::uuid,
        ${type},
        ${idempotencyKey ?? null},
        'running',
        ${dryRun},
        ${this.database.sql.json(input as never)},
        ${userId}::uuid,
        now()
      )
      RETURNING id::text
    `;
    return String(rows[0]?.id ?? "");
  }

  private async finishJob(
    organizationId: string,
    jobId: string,
    state: "succeeded" | "failed",
    result: Record<string, unknown>,
    errorMessage?: string,
  ) {
    const rows = await this.database.sql`
      UPDATE maintenance_jobs
      SET state = ${state},
          result = ${this.database.sql.json(result as never)},
          error_message = ${errorMessage ?? null},
          completed_at = now()
      WHERE organization_id = ${organizationId}::uuid AND id = ${jobId}::uuid
      RETURNING id::text, job_type, state, dry_run, result, error_message, started_at, completed_at
    `;
    return this.mapJob(rows[0]);
  }

  private mapJob(row: Record<string, unknown> | undefined) {
    if (!row) throw new Error("Maintenance job persistence returned no row");
    return {
      id: String(row.id),
      jobType: String(row.job_type),
      state: String(row.state),
      dryRun: Boolean(row.dry_run),
      result: asRecord(row.result),
      ...(row.error_message ? { errorMessage: String(row.error_message) } : {}),
      startedAt: new Date(String(row.started_at)).toISOString(),
      ...(row.completed_at
        ? { completedAt: new Date(String(row.completed_at)).toISOString() }
        : {}),
    };
  }

  async createLegalHold(input: LegalHoldInputDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const userId = actorId(this.authContext);
    if (!input.candidateId && !(input.entityType && input.entityId)) {
      throw new BadRequestException("candidateId or entityType + entityId is required");
    }
    if (input.candidateId) {
      const candidates = await this.database.sql`
        SELECT 1 FROM candidates
        WHERE organization_id = ${organizationId}::uuid AND id = ${input.candidateId}::uuid
        LIMIT 1
      `;
      if (!candidates[0]) throw new NotFoundException("Candidate not found");
    }
    const rows = await this.database.sql`
      INSERT INTO legal_holds (
        organization_id, candidate_id, entity_type, entity_id,
        reason, status, placed_by_user_id
      ) VALUES (
        ${organizationId}::uuid,
        ${input.candidateId ?? null}::uuid,
        ${input.entityType?.trim() || null},
        ${input.entityId ?? null}::uuid,
        ${input.reason.trim()},
        'active',
        ${userId}::uuid
      )
      RETURNING id::text, candidate_id::text, entity_type, entity_id::text,
                reason, status, placed_at, released_at
    `;
    return this.mapHold(rows[0]);
  }

  async releaseLegalHold(holdId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const userId = actorId(this.authContext);
    const rows = await this.database.sql`
      UPDATE legal_holds
      SET status = 'released', released_by_user_id = ${userId}::uuid, released_at = now()
      WHERE organization_id = ${organizationId}::uuid
        AND id = ${holdId}::uuid
        AND status = 'active'
      RETURNING id::text, candidate_id::text, entity_type, entity_id::text,
                reason, status, placed_at, released_at
    `;
    if (!rows[0]) throw new NotFoundException("Active legal hold not found");
    return this.mapHold(rows[0]);
  }

  async listLegalHolds() {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      SELECT id::text, candidate_id::text, entity_type, entity_id::text,
             reason, status, placed_at, released_at
      FROM legal_holds
      WHERE organization_id = ${organizationId}::uuid
      ORDER BY placed_at DESC
    `;
    return rows.map((row) => this.mapHold(row));
  }

  private mapHold(row: Record<string, unknown> | undefined) {
    if (!row) throw new Error("Legal hold persistence returned no row");
    return {
      id: String(row.id),
      ...(row.candidate_id ? { candidateId: String(row.candidate_id) } : {}),
      ...(row.entity_type ? { entityType: String(row.entity_type) } : {}),
      ...(row.entity_id ? { entityId: String(row.entity_id) } : {}),
      reason: String(row.reason),
      status: String(row.status),
      placedAt: new Date(String(row.placed_at)).toISOString(),
      ...(row.released_at ? { releasedAt: new Date(String(row.released_at)).toISOString() } : {}),
    };
  }

  async sessionCleanup(input: SessionCleanupRequestDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const userId = actorId(this.authContext);
    const dryRun = input.dryRun !== false;
    const graceDays = input.graceDays ?? 7;
    const idempotencyKey = input.idempotencyKey?.trim() || undefined;
    const existing = await this.existingJob(organizationId, "session_cleanup", idempotencyKey);
    if (existing) return this.mapJob(existing);
    const jobId = await this.startJob(
      organizationId,
      userId,
      "session_cleanup",
      dryRun,
      { graceDays },
      idempotencyKey,
    );
    try {
      const cutoff = new Date(Date.now() - graceDays * 24 * 60 * 60 * 1000);
      const counts = await this.database.sql`
        SELECT
          (SELECT count(*)::int FROM sessions
            WHERE principal_type = 'candidate'
              AND organization_id = ${organizationId}::uuid
              AND (expires_at < ${cutoff} OR (revoked_at IS NOT NULL AND revoked_at < ${cutoff}))) AS sessions,
          (SELECT count(*)::int FROM invitation_tokens
            WHERE organization_id = ${organizationId}::uuid
              AND (expires_at < ${cutoff} OR (consumed_at IS NOT NULL AND consumed_at < ${cutoff}))) AS invitations
      `;
      const result = {
        candidateSessions: Number(counts[0]?.sessions ?? 0),
        invitationTokens: Number(counts[0]?.invitations ?? 0),
        graceDays,
        deleted: !dryRun,
      };
      if (!dryRun) {
        await this.database.sql.begin(async (tx) => {
          await tx`
            DELETE FROM sessions
            WHERE principal_type = 'candidate'
              AND organization_id = ${organizationId}::uuid
              AND (expires_at < ${cutoff} OR (revoked_at IS NOT NULL AND revoked_at < ${cutoff}))
          `;
          await tx`
            DELETE FROM invitation_tokens
            WHERE organization_id = ${organizationId}::uuid
              AND (expires_at < ${cutoff} OR (consumed_at IS NOT NULL AND consumed_at < ${cutoff}))
          `;
        });
      }
      return this.finishJob(organizationId, jobId, "succeeded", result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown session cleanup failure";
      await this.finishJob(organizationId, jobId, "failed", {}, message);
      throw error;
    }
  }

  async runRetention(input: MaintenanceExecutionDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const userId = actorId(this.authContext);
    const dryRun = input.dryRun !== false;
    const idempotencyKey = input.idempotencyKey?.trim() || undefined;
    const existing = await this.existingJob(organizationId, "retention", idempotencyKey);
    if (existing) return this.mapJob(existing);
    const jobId = await this.startJob(
      organizationId,
      userId,
      "retention",
      dryRun,
      {},
      idempotencyKey,
    );
    try {
      const policies = await this.database.sql`
        SELECT entity_type, retention_days, legal_hold_rules
        FROM retention_policies
        WHERE organization_id = ${organizationId}::uuid AND enabled = true
        ORDER BY entity_type
      `;
      const result: Record<string, unknown> = {};
      for (const policy of policies) {
        const entityType = String(policy.entity_type);
        const retentionDays = Number(policy.retention_days);
        const rules = asRecord(policy.legal_hold_rules);
        if (rules.blockDeletion === true) {
          result[entityType] = { status: "held", retentionDays, eligible: 0 };
          continue;
        }
        const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
        const eligible = await this.retentionCount(organizationId, entityType, cutoff);
        if (eligible === null) {
          result[entityType] = { status: "unsupported_fail_closed", retentionDays, eligible: 0 };
          continue;
        }
        if (!dryRun && eligible > 0) {
          await this.retentionDelete(organizationId, entityType, cutoff);
        }
        result[entityType] = { status: dryRun ? "preview" : "executed", retentionDays, eligible };
      }
      return this.finishJob(organizationId, jobId, "succeeded", result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown retention failure";
      await this.finishJob(organizationId, jobId, "failed", {}, message);
      throw error;
    }
  }

  private async retentionCount(organizationId: string, entityType: string, cutoff: Date): Promise<number | null> {
    switch (entityType) {
      case "ai_executions": {
        const rows = await this.database.sql`
          SELECT count(*)::int AS count FROM ai_executions
          WHERE organization_id = ${organizationId}::uuid AND created_at < ${cutoff}
        `;
        return Number(rows[0]?.count ?? 0);
      }
      case "recruitment_events": {
        const rows = await this.database.sql`
          SELECT count(*)::int AS count FROM recruitment_events
          WHERE organization_id = ${organizationId}::uuid AND occurred_at < ${cutoff}
        `;
        return Number(rows[0]?.count ?? 0);
      }
      case "interview_media_events": {
        const rows = await this.database.sql`
          SELECT count(*)::int AS count FROM interview_media_events
          WHERE organization_id = ${organizationId}::uuid AND occurred_at < ${cutoff}
        `;
        return Number(rows[0]?.count ?? 0);
      }
      default:
        return null;
    }
  }

  private async retentionDelete(organizationId: string, entityType: string, cutoff: Date): Promise<void> {
    switch (entityType) {
      case "ai_executions":
        await this.database.sql`
          DELETE FROM ai_executions
          WHERE organization_id = ${organizationId}::uuid AND created_at < ${cutoff}
        `;
        return;
      case "recruitment_events":
        await this.database.sql`
          DELETE FROM recruitment_events
          WHERE organization_id = ${organizationId}::uuid AND occurred_at < ${cutoff}
        `;
        return;
      case "interview_media_events":
        await this.database.sql`
          DELETE FROM interview_media_events
          WHERE organization_id = ${organizationId}::uuid AND occurred_at < ${cutoff}
        `;
        return;
      default:
        throw new BadRequestException(`Unsupported retention entity type ${entityType}`);
    }
  }

  async executePrivacyDeletion(requestId: string, input: MaintenanceExecutionDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const userId = actorId(this.authContext);
    const dryRun = input.dryRun !== false;
    const idempotencyKey = input.idempotencyKey?.trim() || undefined;
    const existing = await this.existingJob(organizationId, "privacy_deletion", idempotencyKey);
    if (existing) return this.mapJob(existing);
    const requests = await this.database.sql`
      SELECT id::text, candidate_id::text, requested_at
      FROM privacy_requests
      WHERE organization_id = ${organizationId}::uuid
        AND id = ${requestId}::uuid
        AND request_type = 'deletion'
        AND status = 'approved_pending_execution'
      LIMIT 1
    `;
    const request = requests[0];
    if (!request) throw new NotFoundException("Approved deletion request not found");
    const candidateId = String(request.candidate_id);
    const holds = await this.database.sql`
      SELECT id::text FROM legal_holds
      WHERE organization_id = ${organizationId}::uuid
        AND candidate_id = ${candidateId}::uuid
        AND status = 'active'
      LIMIT 1
    `;
    if (holds[0]) throw new BadRequestException("Candidate deletion is blocked by an active legal hold");

    const jobId = await this.startJob(
      organizationId,
      userId,
      "privacy_deletion",
      dryRun,
      { requestId, candidateId },
      idempotencyKey,
    );
    try {
      const counts = await this.database.sql`
        SELECT
          (SELECT count(*)::int FROM applications WHERE organization_id = ${organizationId}::uuid AND candidate_id = ${candidateId}::uuid) AS applications,
          (SELECT count(*)::int FROM candidate_identities WHERE organization_id = ${organizationId}::uuid AND candidate_id = ${candidateId}::uuid) AS identities,
          (SELECT count(*)::int FROM evidence WHERE organization_id = ${organizationId}::uuid AND candidate_id = ${candidateId}::uuid) AS evidence
      `;
      const summary = {
        candidateId,
        applications: Number(counts[0]?.applications ?? 0),
        identities: Number(counts[0]?.identities ?? 0),
        evidence: Number(counts[0]?.evidence ?? 0),
        deleted: !dryRun,
      };
      if (!dryRun) {
        const candidateReferenceHash = createHash("sha256")
          .update(`${organizationId}:${candidateId}`)
          .digest("hex");
        await this.database.sql.begin(async (tx) => {
          await tx`
            INSERT INTO privacy_deletion_receipts (
              organization_id, privacy_request_id, candidate_reference_hash,
              requested_at, executed_by_user_id, deletion_summary
            ) VALUES (
              ${organizationId}::uuid,
              ${requestId}::uuid,
              ${candidateReferenceHash},
              ${new Date(String(request.requested_at))},
              ${userId}::uuid,
              ${this.database.sql.json(summary as never)}
            )
            ON CONFLICT (organization_id, privacy_request_id) DO NOTHING
          `;
          await tx`
            DELETE FROM candidates
            WHERE organization_id = ${organizationId}::uuid AND id = ${candidateId}::uuid
          `;
        });
      }
      return this.finishJob(organizationId, jobId, "succeeded", summary);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown privacy deletion failure";
      await this.finishJob(organizationId, jobId, "failed", {}, message);
      throw error;
    }
  }
}

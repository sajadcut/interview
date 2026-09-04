import { Injectable } from "@nestjs/common";
import { AuthContextService } from "../auth/auth-context.service";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import { PrivacyDeletionQueueService } from "./privacy-deletion-queue.service";
import { isSupportedRetentionEntityType } from "./retention-policy";

const PRIVACY_REQUEST_TYPES = new Set(["access", "deletion", "withdraw_consent"]);

@Injectable()
export class PrivacyService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
    private readonly authContext: AuthContextService,
    private readonly deletionQueue: PrivacyDeletionQueueService,
  ) {}

  async listRetentionPolicies() {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      SELECT id, entity_type, retention_days, enabled, legal_hold_rules, updated_at
      FROM retention_policies
      WHERE organization_id = ${organizationId}::uuid
      ORDER BY entity_type
    `;
    return rows.map((row) => ({
      id: String(row.id),
      entityType: String(row.entity_type),
      retentionDays: Number(row.retention_days),
      enabled: Boolean(row.enabled),
      legalHoldRules:
        row.legal_hold_rules && typeof row.legal_hold_rules === "object"
          ? (row.legal_hold_rules as Record<string, unknown>)
          : {},
      updatedAt: new Date(String(row.updated_at)).toISOString(),
    }));
  }

  async upsertRetentionPolicy(body: unknown) {
    if (!body || typeof body !== "object") throw new Error("Retention policy input is required");
    const value = body as Record<string, unknown>;
    if (typeof value.entityType !== "string" || !value.entityType.trim()) throw new Error("entityType is required");
    const entityType = value.entityType.trim();
    if (!isSupportedRetentionEntityType(entityType)) {
      throw new Error(`Unsupported retention entity type ${entityType}`);
    }
    if (!Number.isInteger(value.retentionDays) || Number(value.retentionDays) <= 0) {
      throw new Error("retentionDays must be a positive integer");
    }
    const legalHoldRules =
      value.legalHoldRules && typeof value.legalHoldRules === "object" && !Array.isArray(value.legalHoldRules)
        ? (value.legalHoldRules as Record<string, unknown>)
        : {};

    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      INSERT INTO retention_policies (
        organization_id, entity_type, retention_days, enabled, legal_hold_rules
      ) VALUES (
        ${organizationId}::uuid,
        ${entityType},
        ${Number(value.retentionDays)},
        ${value.enabled !== false},
        ${this.database.sql.json(legalHoldRules as never)}
      )
      ON CONFLICT (organization_id, entity_type)
      DO UPDATE SET
        retention_days = EXCLUDED.retention_days,
        enabled = EXCLUDED.enabled,
        legal_hold_rules = EXCLUDED.legal_hold_rules,
        updated_at = now()
      RETURNING id, entity_type, retention_days, enabled, legal_hold_rules, updated_at
    `;
    const row = rows[0];
    return {
      id: String(row?.id),
      entityType: String(row?.entity_type),
      retentionDays: Number(row?.retention_days),
      enabled: Boolean(row?.enabled),
      legalHoldRules:
        row?.legal_hold_rules && typeof row.legal_hold_rules === "object"
          ? (row.legal_hold_rules as Record<string, unknown>)
          : {},
      updatedAt: new Date(String(row?.updated_at)).toISOString(),
    };
  }

  async createPrivacyRequest(body: unknown) {
    if (!body || typeof body !== "object") throw new Error("Privacy request input is required");
    const value = body as Record<string, unknown>;
    if (typeof value.candidateId !== "string" || !value.candidateId.trim()) throw new Error("candidateId is required");
    if (typeof value.requestType !== "string" || !PRIVACY_REQUEST_TYPES.has(value.requestType)) {
      throw new Error("Unsupported privacy request type");
    }
    const metadata = value.metadata && typeof value.metadata === "object" && !Array.isArray(value.metadata)
      ? (value.metadata as Record<string, unknown>)
      : {};
    const organizationId = this.tenantContext.require().organizationId;
    const candidate = await this.database.sql`
      SELECT id FROM candidates
      WHERE organization_id = ${organizationId}::uuid AND id = ${value.candidateId}::uuid
      LIMIT 1
    `;
    if (!candidate.length) throw new Error("Candidate not found");

    const rows = await this.database.sql`
      INSERT INTO privacy_requests (
        organization_id, candidate_id, request_type, status, metadata
      ) VALUES (
        ${organizationId}::uuid,
        ${value.candidateId}::uuid,
        ${value.requestType},
        'pending_review',
        ${this.database.sql.json(metadata as never)}
      )
      RETURNING id, candidate_id, request_type, status, requested_at, review_notes,
                completed_at, metadata, subject_digest
    `;
    return this.mapRequest(rows[0]);
  }

  async listPrivacyRequests(status?: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = status
      ? await this.database.sql`
          SELECT id, candidate_id, request_type, status, requested_at, review_notes,
                 completed_at, metadata, subject_digest
          FROM privacy_requests
          WHERE organization_id = ${organizationId}::uuid AND status = ${status}
          ORDER BY requested_at DESC
        `
      : await this.database.sql`
          SELECT id, candidate_id, request_type, status, requested_at, review_notes,
                 completed_at, metadata, subject_digest
          FROM privacy_requests
          WHERE organization_id = ${organizationId}::uuid
          ORDER BY requested_at DESC
        `;
    return rows.map((row) => this.mapRequest(row));
  }

  async reviewPrivacyRequest(requestId: string, body: unknown) {
    if (!body || typeof body !== "object") throw new Error("Privacy review input is required");
    const value = body as Record<string, unknown>;
    if (value.decision !== "approve" && value.decision !== "reject") throw new Error("decision must be approve or reject");
    if (typeof value.reviewNotes !== "string" || !value.reviewNotes.trim()) throw new Error("reviewNotes are required");
    const reviewer = this.authContext.getOptional();
    if (!reviewer) throw new Error("Authenticated reviewer is required");

    const organizationId = this.tenantContext.require().organizationId;
    if (value.decision === "approve") {
      return this.deletionQueue.approvePrivacyRequest({
        organizationId,
        requestId,
        reviewerUserId: reviewer.userId,
        reviewNotes: value.reviewNotes.trim(),
      });
    }

    const rows = await this.database.sql`
      UPDATE privacy_requests
      SET status = 'rejected',
          reviewed_by_user_id = ${reviewer.userId}::uuid,
          review_notes = ${value.reviewNotes.trim()},
          completed_at = now(),
          updated_at = now()
      WHERE organization_id = ${organizationId}::uuid
        AND id = ${requestId}::uuid
        AND status = 'pending_review'
      RETURNING id, candidate_id, request_type, status, requested_at, review_notes,
                completed_at, metadata, subject_digest
    `;
    if (!rows.length) throw new Error("Pending privacy request not found");
    return this.mapRequest(rows[0]);
  }

  private mapRequest(row: Record<string, unknown> | undefined) {
    if (!row) throw new Error("Privacy persistence returned no row");
    const candidateId = row.candidate_id
      ? String(row.candidate_id)
      : row.subject_digest
        ? `deleted:${String(row.subject_digest)}`
        : "deleted";
    return {
      id: String(row.id),
      candidateId,
      requestType: String(row.request_type),
      status: String(row.status),
      requestedAt: new Date(String(row.requested_at)).toISOString(),
      ...(row.review_notes ? { reviewNotes: String(row.review_notes) } : {}),
      ...(row.completed_at ? { completedAt: new Date(String(row.completed_at)).toISOString() } : {}),
      metadata: row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : {},
    };
  }
}

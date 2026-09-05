import { Injectable } from "@nestjs/common";
import { AuthContextService } from "../auth/auth-context.service";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";

function jsonArray(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
@Injectable()
export class InterviewReviewService {
  constructor(private readonly database: DatabaseService, private readonly tenantContext: TenantContextService, private readonly authContext: AuthContextService) {}
  private actor(): string { const id = this.authContext.getOptional()?.userId; if (!id) throw new Error("Authenticated human reviewer is required"); return id; }

  async list(status: string | undefined, requestedLimit: number | undefined) {
    const organizationId = this.tenantContext.require().organizationId;
    const limit = Math.max(1, Math.min(100, Number(requestedLimit ?? 50)));
    if (status && !["pending", "in_review", "completed"].includes(status)) throw new Error("Unsupported review status");
    const rows = status
      ? await this.database.sql`SELECT * FROM interview_review_tasks WHERE organization_id=${organizationId}::uuid AND status=${status} ORDER BY priority, created_at LIMIT ${limit}`
      : await this.database.sql`SELECT * FROM interview_review_tasks WHERE organization_id=${organizationId}::uuid ORDER BY priority, created_at LIMIT ${limit}`;
    return rows.map((row) => this.present(row));
  }

  async claim(id: string) {
    const organizationId = this.tenantContext.require().organizationId; const actor = this.actor();
    const rows = await this.database.sql`
      UPDATE interview_review_tasks SET status='in_review', review_owner_user_id=${actor}::uuid, claimed_at=COALESCE(claimed_at, now()), updated_at=now()
      WHERE organization_id=${organizationId}::uuid AND id=${id}::uuid AND status='pending'
      RETURNING *`;
    if (!rows[0]) throw new Error("Review task is not available to claim");
    return this.present(rows[0]);
  }

  async complete(id: string, body: unknown) {
    const value = body && typeof body === "object" ? body as Record<string, unknown> : {};
    if (!value.humanOverride || typeof value.humanOverride !== "object" || Array.isArray(value.humanOverride)) throw new Error("humanOverride is required");
    if (typeof value.overrideRationale !== "string" || !value.overrideRationale.trim()) throw new Error("overrideRationale is required");
    if (!Array.isArray(value.evidenceReferences) || value.evidenceReferences.some((item) => typeof item !== "string")) throw new Error("evidenceReferences must be a string array");
    if (!Array.isArray(value.criterionComparison)) throw new Error("criterionComparison must be an array");
    const organizationId = this.tenantContext.require().organizationId; const actor = this.actor();
    const rows = await this.database.sql`
      UPDATE interview_review_tasks SET status='completed', reviewer_user_id=${actor}::uuid,
        human_override=${this.database.sql.json(value.humanOverride as never)}, override_rationale=${value.overrideRationale.trim()},
        evidence_references=${this.database.sql.json(value.evidenceReferences as never)}, criterion_comparison=${this.database.sql.json(value.criterionComparison as never)},
        completed_at=now(), updated_at=now()
      WHERE organization_id=${organizationId}::uuid AND id=${id}::uuid AND status='in_review' AND review_owner_user_id=${actor}::uuid
      RETURNING *`;
    if (!rows[0]) throw new Error("Review task must be claimed by the completing reviewer");
    return this.present(rows[0]);
  }

  async candidateComplaint(sessionId: string, body: unknown) {
    const value = body && typeof body === "object" ? body as Record<string, unknown> : {};
    if (typeof value.complaintReference !== "string" || !value.complaintReference.trim()) throw new Error("complaintReference is required");
    const priority = Math.max(0, Math.min(1000, Number(value.priority ?? 25)));
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      INSERT INTO interview_review_tasks(organization_id, interview_session_id, reason_codes, priority, candidate_complaint_reference)
      SELECT ${organizationId}::uuid, s.id, '["candidate_complaint"]'::jsonb, ${priority}, ${value.complaintReference.trim()}
      FROM interview_sessions s WHERE s.organization_id=${organizationId}::uuid AND s.id=${sessionId}::uuid
      RETURNING *`;
    if (!rows[0]) throw new Error("Interview session not found");
    return this.present(rows[0]);
  }

  async history(id: string) {
    const organizationId = this.tenantContext.require().organizationId;
    return this.database.sql`
      SELECT id::text, event_type, actor_user_id::text, snapshot, created_at FROM interview_review_task_events
      WHERE organization_id=${organizationId}::uuid AND review_task_id=${id}::uuid ORDER BY created_at, id`;
  }

  private present(row: Record<string, unknown>) {
    return { id: String(row.id), interviewSessionId: String(row.interview_session_id), ...(row.evaluation_id ? { evaluationId: String(row.evaluation_id) } : {}),
      reasonCodes: jsonArray(row.reason_codes).map(String), priority: Number(row.priority), status: String(row.status),
      ...(row.review_owner_user_id ? { reviewOwnerUserId: String(row.review_owner_user_id) } : {}),
      evidenceReferences: jsonArray(row.evidence_references).map(String), criterionComparison: jsonArray(row.criterion_comparison),
      ...(row.override_rationale ? { overrideRationale: String(row.override_rationale) } : {}), createdAt: new Date(String(row.created_at)).toISOString() };
  }
}

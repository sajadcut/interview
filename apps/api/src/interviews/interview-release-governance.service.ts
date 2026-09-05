import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { AuthContextService } from "../auth/auth-context.service";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";

function requiredText(value: unknown, name: string, max = 1024): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  const text = value.trim();
  if (text.length > max) throw new Error(`${name} is too long`);
  return text;
}
function stringList(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${name} must be a string array`);
  }
  return value.map((item) => String(item).trim());
}
function stableFingerprint(material: Record<string, string>): string {
  const sorted = Object.fromEntries(Object.entries(material).sort(([a], [b]) => a.localeCompare(b)));
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}

@Injectable()
export class InterviewReleaseGovernanceService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
    private readonly authContext: AuthContextService,
  ) {}

  private actorUserId(): string {
    const actor = this.authContext.getOptional()?.userId;
    if (!actor) throw new Error("Authenticated human actor is required for release governance");
    return actor;
  }

  async approve(releaseUnitId: string, body: unknown) {
    if (!body || typeof body !== "object") throw new Error("Release approval artifact is required");
    const value = body as Record<string, unknown>;
    const rubricVersion = requiredText(value.rubricVersion, "rubricVersion", 120);
    const promptVersionFamily = requiredText(value.promptVersionFamily, "promptVersionFamily", 160);
    const validationDatasetVersion = requiredText(value.validationDatasetVersion, "validationDatasetVersion", 160);
    const calibrationReportReference = requiredText(value.calibrationReportReference, "calibrationReportReference");
    const securityReviewReference = requiredText(value.securityReviewReference, "securityReviewReference");
    const privacyComplianceReviewReference = requiredText(value.privacyComplianceReviewReference, "privacyComplianceReviewReference");
    const knownLimitations = stringList(value.knownLimitations, "knownLimitations");
    const rollbackConditions = stringList(value.rollbackConditions, "rollbackConditions");
    const suspensionConditions = stringList(value.suspensionConditions, "suspensionConditions");
    if (rollbackConditions.length === 0 || suspensionConditions.length === 0) {
      throw new Error("Release approval requires explicit rollback and suspension conditions");
    }
    const approvalExpiresAt = new Date(requiredText(value.approvalExpiresAt, "approvalExpiresAt", 80));
    if (!Number.isFinite(approvalExpiresAt.getTime()) || approvalExpiresAt.getTime() <= Date.now()) {
      throw new Error("approvalExpiresAt must be a valid future date");
    }

    const organizationId = this.tenantContext.require().organizationId;
    const actorUserId = this.actorUserId();
    return this.database.sql.begin(async (transaction) => {
      const rows = await transaction`
        SELECT id, lifecycle_stage, job_family, language, interview_type, rubric_version_family,
               interviewer_policy_version, evaluator_version, speech_avatar_stack_version
        FROM interview_release_units
        WHERE organization_id = ${organizationId}::uuid AND id = ${releaseUnitId}::uuid
        FOR UPDATE
      `;
      if (!rows[0]) throw new Error("Interview release unit not found");
      const row = rows[0];
      if (!["CONTROLLED_PRODUCTION", "SCALED_PRODUCTION"].includes(String(row.lifecycle_stage))) {
        throw new Error("Only controlled/scaled production release units can receive a production approval artifact");
      }
      const material = {
        lifecycleStage: String(row.lifecycle_stage), jobFamily: String(row.job_family), language: String(row.language),
        interviewType: String(row.interview_type), rubricVersionFamily: String(row.rubric_version_family), rubricVersion,
        interviewerPolicyVersion: String(row.interviewer_policy_version), promptVersionFamily,
        evaluatorVersion: String(row.evaluator_version), speechStackVersion: String(row.speech_avatar_stack_version),
        validationDatasetVersion,
      };
      const fingerprint = stableFingerprint(material);

      await transaction`
        UPDATE interview_release_units SET
          rubric_version = ${rubricVersion}, prompt_version_family = ${promptVersionFamily},
          validation_dataset_version = ${validationDatasetVersion},
          calibration_report_reference = ${calibrationReportReference}, security_review_reference = ${securityReviewReference},
          privacy_compliance_review_reference = ${privacyComplianceReviewReference},
          known_limitations = ${this.database.sql.json(knownLimitations as never)},
          rollback_conditions = ${this.database.sql.json(rollbackConditions as never)},
          suspension_conditions = ${this.database.sql.json(suspensionConditions as never)},
          approval_status = 'pending', material_fingerprint = ${fingerprint}
        WHERE organization_id = ${organizationId}::uuid AND id = ${releaseUnitId}::uuid
      `;
      await transaction`
        UPDATE interview_release_units SET
          approval_status = 'approved', approved_by_user_id = ${actorUserId}::uuid, approved_at = now(),
          approval_expires_at = ${approvalExpiresAt.toISOString()}::timestamptz,
          material_fingerprint = ${fingerprint}, approved_material_fingerprint = ${fingerprint},
          production_approved_at = now(), production_approved_by_user_id = ${actorUserId}::uuid,
          suspended_by_user_id = NULL, suspended_at = NULL, suspension_reason = NULL
        WHERE organization_id = ${organizationId}::uuid AND id = ${releaseUnitId}::uuid
        RETURNING id, lifecycle_stage, approval_status, approved_at, approval_expires_at, material_fingerprint
      `;
      return {
        id: String(releaseUnitId), lifecycleStage: String(row.lifecycle_stage), approvalStatus: "approved",
        approvedByUserId: actorUserId, approvalExpiresAt: approvalExpiresAt.toISOString(), materialFingerprint: fingerprint,
        finalHiringAuthority: "human",
      };
    });
  }

  async suspend(releaseUnitId: string, body: unknown) {
    const value = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const reason = requiredText(value.reason, "reason", 4000);
    const organizationId = this.tenantContext.require().organizationId;
    const actorUserId = this.actorUserId();
    const rows = await this.database.sql`
      UPDATE interview_release_units SET
        lifecycle_stage = 'SUSPENDED', approval_status = 'suspended', suspended_by_user_id = ${actorUserId}::uuid,
        suspended_at = now(), suspension_reason = ${reason}, updated_at = now()
      WHERE organization_id = ${organizationId}::uuid AND id = ${releaseUnitId}::uuid
      RETURNING id, lifecycle_stage, approval_status, suspended_at
    `;
    if (!rows[0]) throw new Error("Interview release unit not found");
    return { id: releaseUnitId, lifecycleStage: "SUSPENDED", approvalStatus: "suspended", reason };
  }

  async history(releaseUnitId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      SELECT id, event_type, actor_user_id, reason, artifact_snapshot, created_at
      FROM interview_release_approval_events
      WHERE organization_id = ${organizationId}::uuid AND release_unit_id = ${releaseUnitId}::uuid
      ORDER BY created_at DESC, id DESC LIMIT 500
    `;
    return rows.map((row) => ({
      id: String(row.id), eventType: String(row.event_type), ...(row.actor_user_id ? { actorUserId: String(row.actor_user_id) } : {}),
      ...(row.reason ? { reason: String(row.reason) } : {}), artifactSnapshot: row.artifact_snapshot as Record<string, unknown>,
      createdAt: new Date(String(row.created_at)).toISOString(),
    }));
  }
}

import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Sql } from "postgres";
import { AuthContextService } from "../auth/auth-context.service";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import { SupervisedPilotRuntimeGateService } from "./supervised-pilot-runtime-gate.service";

export const SUPERVISED_PILOT_APPROVAL_KINDS = [
  "customer_acknowledgement",
  "pilot_owner",
  "security_baseline",
  "go_live",
] as const;
export type SupervisedPilotApprovalKind = (typeof SUPERVISED_PILOT_APPROVAL_KINDS)[number];

const PILOT_RECOMMENDATIONS = ["advance", "hold", "reject", "hire", "insufficient_evidence"] as const;
type PilotRecommendation = (typeof PILOT_RECOMMENDATIONS)[number];

function actorId(auth: AuthContextService): string {
  const userId = auth.getOptional()?.userId;
  if (!userId) throw new BadRequestException("Authenticated user context is required");
  return userId;
}

function asObject(value: unknown, message = "Input is required"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException(message);
  return value as Record<string, unknown>;
}

function requiredString(value: Record<string, unknown>, key: string, minLength = 1): string {
  const candidate = value[key];
  if (typeof candidate !== "string" || candidate.trim().length < minLength) {
    throw new BadRequestException(`${key} is required`);
  }
  return candidate.trim();
}

function optionalString(value: Record<string, unknown>, key: string): string | null {
  const candidate = value[key];
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

function positiveInteger(value: Record<string, unknown>, key: string, fallback?: number): number {
  const candidate = value[key] ?? fallback;
  if (typeof candidate !== "number" || !Number.isInteger(candidate) || candidate <= 0) {
    throw new BadRequestException(`${key} must be a positive integer`);
  }
  return candidate;
}

function isoDate(value: Record<string, unknown>, key: string): Date {
  const candidate = requiredString(value, key);
  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) throw new BadRequestException(`${key} must be a valid date-time`);
  return parsed;
}

function booleanValue(value: Record<string, unknown>, key: string): boolean {
  if (typeof value[key] !== "boolean") throw new BadRequestException(`${key} must be boolean`);
  return value[key] as boolean;
}

function approvalKind(value: string): SupervisedPilotApprovalKind {
  if (!SUPERVISED_PILOT_APPROVAL_KINDS.includes(value as SupervisedPilotApprovalKind)) {
    throw new BadRequestException("Unsupported pilot approval kind");
  }
  return value as SupervisedPilotApprovalKind;
}

function recommendation(value: Record<string, unknown>): PilotRecommendation {
  const candidate = requiredString(value, "recommendation");
  if (!PILOT_RECOMMENDATIONS.includes(candidate as PilotRecommendation)) {
    throw new BadRequestException("Unsupported human review recommendation");
  }
  return candidate as PilotRecommendation;
}

@Injectable()
export class SupervisedPilotService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
    private readonly authContext: AuthContextService,
    private readonly runtimeGate: SupervisedPilotRuntimeGateService,
  ) {}

  async createProgram(body: unknown) {
    const value = asObject(body, "Pilot program input is required");
    const organizationId = this.tenantContext.require().organizationId;
    const userId = actorId(this.authContext);
    const releaseUnitId = requiredString(value, "releaseUnitId");
    const name = requiredString(value, "name");
    const description = optionalString(value, "description");
    const maxTotalInterviews = positiveInteger(value, "maxTotalInterviews");
    const maxConcurrentInterviews = positiveInteger(value, "maxConcurrentInterviews");
    const maxInterviewsPerCandidate = positiveInteger(value, "maxInterviewsPerCandidate", 1);
    if (maxConcurrentInterviews > maxTotalInterviews) {
      throw new BadRequestException("maxConcurrentInterviews cannot exceed maxTotalInterviews");
    }
    const startsAt = isoDate(value, "startsAt");
    const endsAt = isoDate(value, "endsAt");
    if (endsAt <= startsAt) throw new BadRequestException("endsAt must be after startsAt");
    const defaultReviewOwnerUserId = requiredString(value, "defaultReviewOwnerUserId");
    const incidentOwnerUserId = requiredString(value, "incidentOwnerUserId");
    const supportContact = requiredString(value, "supportContact", 3);

    const releaseRows = await this.database.sql`
      SELECT lifecycle_stage
      FROM interview_release_units
      WHERE organization_id = ${organizationId}::uuid AND id = ${releaseUnitId}::uuid
      LIMIT 1
    `;
    if (!releaseRows[0]) throw new NotFoundException("Interview release unit not found");
    if (!["SHADOW", "SUPERVISED_PILOT"].includes(String(releaseRows[0].lifecycle_stage))) {
      throw new BadRequestException("Pilot controls may only be prepared from SHADOW or SUPERVISED_PILOT release stage");
    }
    await this.assertActiveMember(defaultReviewOwnerUserId);
    await this.assertActiveMember(incidentOwnerUserId);

    const rows = await this.database.sql`
      INSERT INTO supervised_pilot_programs (
        organization_id, release_unit_id, name, description,
        max_total_interviews, max_concurrent_interviews, max_interviews_per_candidate,
        starts_at, ends_at, default_review_owner_user_id, incident_owner_user_id,
        support_contact, created_by_user_id
      ) VALUES (
        ${organizationId}::uuid, ${releaseUnitId}::uuid, ${name}, ${description},
        ${maxTotalInterviews}, ${maxConcurrentInterviews}, ${maxInterviewsPerCandidate},
        ${startsAt}, ${endsAt}, ${defaultReviewOwnerUserId}::uuid, ${incidentOwnerUserId}::uuid,
        ${supportContact}, ${userId}::uuid
      )
      RETURNING id::text, release_unit_id::text, name, status, feature_enabled,
                max_total_interviews, max_concurrent_interviews, max_interviews_per_candidate,
                starts_at, ends_at, default_review_owner_user_id::text,
                incident_owner_user_id::text, support_contact, created_at
    `;
    return this.programView(rows[0]);
  }

  async listPrograms() {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      SELECT p.id::text, p.release_unit_id::text, p.name, p.status, p.feature_enabled,
             p.max_total_interviews, p.max_concurrent_interviews, p.max_interviews_per_candidate,
             p.starts_at, p.ends_at, p.default_review_owner_user_id::text,
             p.incident_owner_user_id::text, p.support_contact, p.created_at,
             r.lifecycle_stage
      FROM supervised_pilot_programs p
      JOIN interview_release_units r
        ON r.organization_id = p.organization_id AND r.id = p.release_unit_id
      WHERE p.organization_id = ${organizationId}::uuid
      ORDER BY p.created_at DESC
    `;
    return {
      systemFeatureEnabled: this.runtimeGate.isEnabled(),
      programs: rows.map((row) => ({ ...this.programView(row), lifecycleStage: String(row.lifecycle_stage) })),
    };
  }

  async setFeature(programId: string, body: unknown) {
    const value = asObject(body, "Pilot feature input is required");
    const enabled = booleanValue(value, "enabled");
    const organizationId = this.tenantContext.require().organizationId;
    const userId = actorId(this.authContext);

    return this.database.sql.begin(async (tx) => {
      const programs = await tx`
        SELECT status
        FROM supervised_pilot_programs
        WHERE organization_id = ${organizationId}::uuid AND id = ${programId}::uuid
        FOR UPDATE
      `;
      if (!programs[0]) throw new NotFoundException("Pilot program not found");
      const status = String(programs[0].status);
      if (["completed", "revoked"].includes(status)) {
        throw new BadRequestException("Completed or revoked pilot programs cannot change feature state");
      }
      const rows = await tx`
        UPDATE supervised_pilot_programs
        SET feature_enabled = ${enabled},
            status = CASE WHEN ${enabled} = false AND status = 'active' THEN 'paused' ELSE status END,
            paused_by_user_id = CASE WHEN ${enabled} = false AND status = 'active' THEN ${userId}::uuid ELSE paused_by_user_id END,
            paused_at = CASE WHEN ${enabled} = false AND status = 'active' THEN now() ELSE paused_at END,
            updated_at = now()
        WHERE organization_id = ${organizationId}::uuid AND id = ${programId}::uuid
        RETURNING id::text, status, feature_enabled
      `;
      return {
        id: String(rows[0]?.id),
        status: String(rows[0]?.status),
        featureEnabled: Boolean(rows[0]?.feature_enabled),
        systemFeatureEnabled: this.runtimeGate.isEnabled(),
        failClosed: true,
      };
    });
  }

  async submitForApproval(programId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const userId = actorId(this.authContext);
    return this.database.sql.begin(async (tx) => {
      const programs = await tx`
        SELECT p.status, p.release_unit_id::text, r.lifecycle_stage,
               p.default_review_owner_user_id::text, p.incident_owner_user_id::text,
               p.support_contact
        FROM supervised_pilot_programs p
        JOIN interview_release_units r
          ON r.organization_id = p.organization_id AND r.id = p.release_unit_id
        WHERE p.organization_id = ${organizationId}::uuid AND p.id = ${programId}::uuid
        FOR UPDATE OF p
      `;
      const program = programs[0];
      if (!program) throw new NotFoundException("Pilot program not found");
      if (String(program.status) !== "draft") throw new BadRequestException("Only draft pilot programs can be submitted");
      if (String(program.lifecycle_stage) !== "SUPERVISED_PILOT") {
        throw new BadRequestException("Release unit must be in SUPERVISED_PILOT before approval starts");
      }
      await this.assertActiveMemberWithTx(tx, String(program.default_review_owner_user_id));
      await this.assertActiveMemberWithTx(tx, String(program.incident_owner_user_id));
      if (!String(program.support_contact ?? "").trim()) throw new BadRequestException("Pilot support contact is required");

      for (const kind of SUPERVISED_PILOT_APPROVAL_KINDS) {
        const steps = await tx`
          INSERT INTO supervised_pilot_approval_steps (
            organization_id, program_id, step_kind, status, requested_by_user_id
          ) VALUES (
            ${organizationId}::uuid, ${programId}::uuid, ${kind}, 'pending', ${userId}::uuid
          )
          ON CONFLICT (organization_id, program_id, step_kind) DO UPDATE
          SET status = 'pending', requested_by_user_id = EXCLUDED.requested_by_user_id,
              decided_by_user_id = NULL, rationale = NULL, evidence_reference = NULL,
              decided_at = NULL, updated_at = now()
          RETURNING id::text
        `;
        await tx`
          INSERT INTO supervised_pilot_approval_events (
            organization_id, program_id, approval_step_id, event_type, actor_user_id
          ) VALUES (
            ${organizationId}::uuid, ${programId}::uuid, ${String(steps[0]?.id)}::uuid,
            'requested', ${userId}::uuid
          )
        `;
      }
      await tx`
        UPDATE supervised_pilot_programs
        SET status = 'pending_approval', submitted_by_user_id = ${userId}::uuid,
            submitted_at = now(), updated_at = now()
        WHERE organization_id = ${organizationId}::uuid AND id = ${programId}::uuid
      `;
      return { id: programId, status: "pending_approval" as const, requiredApprovals: [...SUPERVISED_PILOT_APPROVAL_KINDS] };
    });
  }

  async decideApproval(programId: string, kindValue: string, body: unknown, decision: "approved" | "rejected") {
    const value = asObject(body, "Pilot approval decision is required");
    const kind = approvalKind(kindValue);
    const rationale = requiredString(value, "rationale", 3);
    const evidenceReference = optionalString(value, "evidenceReference");
    if (["customer_acknowledgement", "security_baseline"].includes(kind) && !evidenceReference) {
      throw new BadRequestException(`${kind} requires evidenceReference`);
    }
    const organizationId = this.tenantContext.require().organizationId;
    const userId = actorId(this.authContext);
    await this.assertActiveMember(userId);

    return this.database.sql.begin(async (tx) => {
      const programs = await tx`
        SELECT status, created_by_user_id::text
        FROM supervised_pilot_programs
        WHERE organization_id = ${organizationId}::uuid AND id = ${programId}::uuid
        FOR UPDATE
      `;
      const program = programs[0];
      if (!program) throw new NotFoundException("Pilot program not found");
      if (String(program.status) !== "pending_approval") {
        throw new BadRequestException("Pilot program is not awaiting approval");
      }
      if (["security_baseline", "go_live"].includes(kind) && String(program.created_by_user_id) === userId) {
        throw new BadRequestException(`${kind} requires an independent approver`);
      }
      if (kind === "go_live" && decision === "approved") {
        const prior = await tx`
          SELECT step_kind, status, decided_by_user_id::text
          FROM supervised_pilot_approval_steps
          WHERE organization_id = ${organizationId}::uuid AND program_id = ${programId}::uuid
        `;
        for (const required of ["customer_acknowledgement", "pilot_owner", "security_baseline"] as const) {
          const step = prior.find((row) => String(row.step_kind) === required);
          if (!step || String(step.status) !== "approved") {
            throw new BadRequestException(`go_live requires approved ${required}`);
          }
        }
        const security = prior.find((row) => String(row.step_kind) === "security_baseline");
        if (security?.decided_by_user_id && String(security.decided_by_user_id) === userId) {
          throw new BadRequestException("go_live approver must differ from security_baseline approver");
        }
      }

      const steps = await tx`
        SELECT id::text
        FROM supervised_pilot_approval_steps
        WHERE organization_id = ${organizationId}::uuid
          AND program_id = ${programId}::uuid
          AND step_kind = ${kind}
        FOR UPDATE
      `;
      if (!steps[0]) throw new NotFoundException("Pilot approval step not found");
      const stepId = String(steps[0].id);
      await tx`
        UPDATE supervised_pilot_approval_steps
        SET status = ${decision}, decided_by_user_id = ${userId}::uuid,
            rationale = ${rationale}, evidence_reference = ${evidenceReference},
            decided_at = now(), updated_at = now()
        WHERE organization_id = ${organizationId}::uuid AND id = ${stepId}::uuid
      `;
      await tx`
        INSERT INTO supervised_pilot_approval_events (
          organization_id, program_id, approval_step_id, event_type,
          actor_user_id, rationale, evidence_reference
        ) VALUES (
          ${organizationId}::uuid, ${programId}::uuid, ${stepId}::uuid,
          ${decision === "approved" ? "approved" : "rejected"},
          ${userId}::uuid, ${rationale}, ${evidenceReference}
        )
      `;

      const aggregate = await tx`
        SELECT count(*) FILTER (WHERE status = 'approved')::int AS approved_count,
               count(*) FILTER (WHERE status = 'rejected')::int AS rejected_count
        FROM supervised_pilot_approval_steps
        WHERE organization_id = ${organizationId}::uuid AND program_id = ${programId}::uuid
      `;
      const approvedCount = Number(aggregate[0]?.approved_count ?? 0);
      const rejectedCount = Number(aggregate[0]?.rejected_count ?? 0);
      if (approvedCount === SUPERVISED_PILOT_APPROVAL_KINDS.length && rejectedCount === 0) {
        await tx`
          UPDATE supervised_pilot_programs
          SET status = 'approved', updated_at = now()
          WHERE organization_id = ${organizationId}::uuid AND id = ${programId}::uuid
        `;
      }
      return {
        programId,
        kind,
        decision,
        programStatus: approvedCount === SUPERVISED_PILOT_APPROVAL_KINDS.length && rejectedCount === 0
          ? "approved"
          : "pending_approval",
      };
    });
  }

  async activate(programId: string) {
    if (!this.runtimeGate.isEnabled()) {
      throw new BadRequestException("Supervised pilot runtime feature flag is disabled");
    }
    const organizationId = this.tenantContext.require().organizationId;
    const userId = actorId(this.authContext);
    return this.database.sql.begin(async (tx) => {
      const programs = await tx`
        SELECT p.status, p.feature_enabled, p.starts_at, p.ends_at,
               p.default_review_owner_user_id::text, p.incident_owner_user_id::text,
               r.lifecycle_stage
        FROM supervised_pilot_programs p
        JOIN interview_release_units r
          ON r.organization_id = p.organization_id AND r.id = p.release_unit_id
        WHERE p.organization_id = ${organizationId}::uuid AND p.id = ${programId}::uuid
        FOR UPDATE OF p
      `;
      const program = programs[0];
      if (!program) throw new NotFoundException("Pilot program not found");
      if (!["approved", "paused"].includes(String(program.status))) {
        throw new BadRequestException("Pilot program must be approved or paused before activation");
      }
      if (program.feature_enabled !== true) throw new BadRequestException("Pilot program feature flag is disabled");
      if (String(program.lifecycle_stage) !== "SUPERVISED_PILOT") {
        throw new BadRequestException("Release unit must remain in SUPERVISED_PILOT");
      }
      const now = Date.now();
      if (now < new Date(String(program.starts_at)).getTime() || now > new Date(String(program.ends_at)).getTime()) {
        throw new BadRequestException("Pilot program is outside its approved time window");
      }
      await this.assertActiveMemberWithTx(tx, String(program.default_review_owner_user_id));
      await this.assertActiveMemberWithTx(tx, String(program.incident_owner_user_id));
      await this.assertAllApprovalsWithTx(tx, organizationId, programId);

      const rows = await tx`
        UPDATE supervised_pilot_programs
        SET status = 'active', activated_by_user_id = ${userId}::uuid,
            activated_at = COALESCE(activated_at, now()), paused_by_user_id = NULL,
            paused_at = NULL, updated_at = now()
        WHERE organization_id = ${organizationId}::uuid AND id = ${programId}::uuid
        RETURNING id::text, status
      `;
      return { id: String(rows[0]?.id), status: String(rows[0]?.status), systemFeatureEnabled: true };
    });
  }

  async pause(programId: string) {
    return this.transitionActiveProgram(programId, "paused");
  }

  async revoke(programId: string) {
    return this.transitionActiveProgram(programId, "revoked");
  }

  async complete(programId: string) {
    return this.transitionActiveProgram(programId, "completed");
  }

  async reassignReview(sessionId: string, body: unknown) {
    const value = asObject(body, "Pilot review reassignment is required");
    const reviewOwnerUserId = requiredString(value, "reviewOwnerUserId");
    const organizationId = this.tenantContext.require().organizationId;
    await this.assertActiveMember(reviewOwnerUserId);
    return this.database.sql.begin(async (tx) => {
      const rows = await tx`
        SELECT r.id::text, r.status, a.id::text AS admission_id
        FROM supervised_pilot_human_reviews r
        JOIN supervised_pilot_admissions a
          ON a.organization_id = r.organization_id AND a.id = r.admission_id
        WHERE r.organization_id = ${organizationId}::uuid
          AND r.interview_session_id = ${sessionId}::uuid
        FOR UPDATE OF r, a
      `;
      if (!rows[0]) throw new NotFoundException("Pilot human review not found");
      if (String(rows[0].status) !== "pending") throw new BadRequestException("Completed human reviews are immutable");
      await tx`
        UPDATE supervised_pilot_human_reviews
        SET review_owner_user_id = ${reviewOwnerUserId}::uuid, updated_at = now()
        WHERE organization_id = ${organizationId}::uuid AND id = ${String(rows[0].id)}::uuid
      `;
      await tx`
        UPDATE supervised_pilot_admissions
        SET review_owner_user_id = ${reviewOwnerUserId}::uuid, updated_at = now()
        WHERE organization_id = ${organizationId}::uuid AND id = ${String(rows[0].admission_id)}::uuid
      `;
      return { sessionId, reviewOwnerUserId, status: "pending" as const };
    });
  }

  async recordHumanReview(sessionId: string, body: unknown) {
    const value = asObject(body, "Pilot human review is required");
    const humanRecommendation = recommendation(value);
    const notes = requiredString(value, "notes", 3);
    const organizationId = this.tenantContext.require().organizationId;
    const userId = actorId(this.authContext);

    return this.database.sql.begin(async (tx) => {
      const rows = await tx`
        SELECT r.id::text, r.status, r.review_owner_user_id::text,
               a.id::text AS admission_id, s.status AS session_status
        FROM supervised_pilot_human_reviews r
        JOIN supervised_pilot_admissions a
          ON a.organization_id = r.organization_id AND a.id = r.admission_id
        JOIN interview_sessions s
          ON s.organization_id = r.organization_id AND s.id = r.interview_session_id
        WHERE r.organization_id = ${organizationId}::uuid
          AND r.interview_session_id = ${sessionId}::uuid
        FOR UPDATE OF r, a
      `;
      const review = rows[0];
      if (!review) throw new NotFoundException("Pilot human review not found");
      if (String(review.status) !== "pending") throw new BadRequestException("Human review is already completed and immutable");
      if (String(review.review_owner_user_id) !== userId) {
        throw new BadRequestException("Only the assigned human review owner may complete this review");
      }
      if (String(review.session_status) !== "completed") {
        throw new BadRequestException("Pilot human review requires a completed interview session");
      }
      await tx`
        UPDATE supervised_pilot_human_reviews
        SET status = 'completed', reviewer_user_id = ${userId}::uuid,
            recommendation = ${humanRecommendation}, notes = ${notes},
            reviewed_at = now(), updated_at = now()
        WHERE organization_id = ${organizationId}::uuid AND id = ${String(review.id)}::uuid
      `;
      await tx`
        UPDATE supervised_pilot_admissions
        SET status = 'completed', completed_at = now(), updated_at = now()
        WHERE organization_id = ${organizationId}::uuid AND id = ${String(review.admission_id)}::uuid
      `;
      return {
        sessionId,
        status: "completed" as const,
        recommendation: humanRecommendation,
        reviewerUserId: userId,
        humanDecisionAuthority: true,
        aiFinalDecisionProhibited: true,
      };
    });
  }

  async createAdmittedSession(input: {
    releaseUnitId: string;
    applicationId: string;
    interviewPlanId: string;
    remainingSeconds: number;
    checkpoint: Record<string, unknown>;
    requestedReviewOwnerUserId?: string;
  }) {
    if (!this.runtimeGate.isEnabled()) {
      throw new BadRequestException("Supervised pilot runtime feature flag is disabled");
    }
    const organizationId = this.tenantContext.require().organizationId;

    return this.database.sql.begin(async (tx) => {
      const programs = await tx`
        SELECT id::text, status, feature_enabled, max_total_interviews,
               max_concurrent_interviews, max_interviews_per_candidate,
               starts_at, ends_at, default_review_owner_user_id::text
        FROM supervised_pilot_programs
        WHERE organization_id = ${organizationId}::uuid
          AND release_unit_id = ${input.releaseUnitId}::uuid
          AND status = 'active'
        LIMIT 1
        FOR UPDATE
      `;
      const program = programs[0];
      if (!program) throw new BadRequestException("No active supervised pilot program exists for this release unit");
      if (program.feature_enabled !== true) throw new BadRequestException("Pilot program feature flag is disabled");
      const now = Date.now();
      if (now < new Date(String(program.starts_at)).getTime() || now > new Date(String(program.ends_at)).getTime()) {
        throw new BadRequestException("Pilot program is outside its approved time window");
      }
      await this.assertAllApprovalsWithTx(tx, organizationId, String(program.id));

      const applicationRows = await tx`
        SELECT candidate_id::text
        FROM applications
        WHERE organization_id = ${organizationId}::uuid AND id = ${input.applicationId}::uuid
        LIMIT 1
      `;
      const candidateId = applicationRows[0]?.candidate_id ? String(applicationRows[0].candidate_id) : null;
      if (!candidateId) throw new NotFoundException("Application not found");

      const counts = await tx`
        SELECT count(*) FILTER (WHERE status <> 'cancelled')::int AS total_count,
               count(*) FILTER (WHERE status = 'admitted')::int AS active_count
        FROM supervised_pilot_admissions
        WHERE organization_id = ${organizationId}::uuid AND program_id = ${String(program.id)}::uuid
      `;
      if (Number(counts[0]?.total_count ?? 0) >= Number(program.max_total_interviews)) {
        throw new BadRequestException("Pilot total interview limit has been reached");
      }
      if (Number(counts[0]?.active_count ?? 0) >= Number(program.max_concurrent_interviews)) {
        throw new BadRequestException("Pilot concurrent/open interview limit has been reached");
      }
      const candidateCounts = await tx`
        SELECT count(*)::int AS count
        FROM supervised_pilot_admissions
        WHERE organization_id = ${organizationId}::uuid
          AND program_id = ${String(program.id)}::uuid
          AND candidate_id = ${candidateId}::uuid
          AND status <> 'cancelled'
      `;
      if (Number(candidateCounts[0]?.count ?? 0) >= Number(program.max_interviews_per_candidate)) {
        throw new BadRequestException("Pilot per-candidate interview limit has been reached");
      }

      const reviewOwnerUserId = input.requestedReviewOwnerUserId?.trim() || String(program.default_review_owner_user_id);
      await this.assertActiveMemberWithTx(tx, reviewOwnerUserId);

      const sessions = await tx`
        INSERT INTO interview_sessions (
          organization_id, application_id, interview_plan_id, status, remaining_seconds, checkpoint
        ) VALUES (
          ${organizationId}::uuid, ${input.applicationId}::uuid, ${input.interviewPlanId}::uuid,
          'invited', ${input.remainingSeconds},
          ${this.database.sql.json({
            ...input.checkpoint,
            supervisedPilot: true,
            pilotProgramId: String(program.id),
            pilotHumanReviewRequired: true,
            pilotAiFinalDecisionProhibited: true,
            pilotReviewOwnerUserId: reviewOwnerUserId,
          } as never)}
        )
        RETURNING id::text, status
      `;
      const sessionId = String(sessions[0]?.id);
      const admissions = await tx`
        INSERT INTO supervised_pilot_admissions (
          organization_id, program_id, interview_session_id, application_id,
          candidate_id, review_owner_user_id
        ) VALUES (
          ${organizationId}::uuid, ${String(program.id)}::uuid, ${sessionId}::uuid,
          ${input.applicationId}::uuid, ${candidateId}::uuid, ${reviewOwnerUserId}::uuid
        )
        RETURNING id::text
      `;
      const admissionId = String(admissions[0]?.id);
      await tx`
        INSERT INTO supervised_pilot_human_reviews (
          organization_id, admission_id, interview_session_id, review_owner_user_id
        ) VALUES (
          ${organizationId}::uuid, ${admissionId}::uuid, ${sessionId}::uuid, ${reviewOwnerUserId}::uuid
        )
      `;
      return {
        id: sessionId,
        status: String(sessions[0]?.status),
        pilotProgramId: String(program.id),
        admissionId,
        reviewOwnerUserId,
        humanReviewRequired: true,
        aiFinalDecisionProhibited: true,
      };
    });
  }

  async assertHumanReviewCompleteForApplication(applicationId: string): Promise<{ required: boolean; completed: boolean }> {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      SELECT count(*)::int AS admission_count,
             count(*) FILTER (WHERE a.status <> 'cancelled' AND r.status <> 'completed')::int AS incomplete_count
      FROM supervised_pilot_admissions a
      JOIN supervised_pilot_human_reviews r
        ON r.organization_id = a.organization_id AND r.admission_id = a.id
      WHERE a.organization_id = ${organizationId}::uuid
        AND a.application_id = ${applicationId}::uuid
        AND a.status <> 'cancelled'
    `;
    const admissionCount = Number(rows[0]?.admission_count ?? 0);
    if (admissionCount === 0) return { required: false, completed: true };
    const incompleteCount = Number(rows[0]?.incomplete_count ?? 0);
    if (incompleteCount > 0) {
      throw new BadRequestException("Supervised pilot human review must be completed before this hiring action");
    }
    return { required: true, completed: true };
  }

  async summary(programId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const programs = await this.database.sql`
      SELECT p.id::text, p.release_unit_id::text, p.name, p.status, p.feature_enabled,
             p.max_total_interviews, p.max_concurrent_interviews, p.max_interviews_per_candidate,
             p.starts_at, p.ends_at, p.default_review_owner_user_id::text,
             p.incident_owner_user_id::text, p.support_contact, p.created_at,
             r.lifecycle_stage
      FROM supervised_pilot_programs p
      JOIN interview_release_units r
        ON r.organization_id = p.organization_id AND r.id = p.release_unit_id
      WHERE p.organization_id = ${organizationId}::uuid AND p.id = ${programId}::uuid
      LIMIT 1
    `;
    if (!programs[0]) throw new NotFoundException("Pilot program not found");
    const approvals = await this.database.sql`
      SELECT step_kind, status, decided_by_user_id::text, rationale, evidence_reference, decided_at
      FROM supervised_pilot_approval_steps
      WHERE organization_id = ${organizationId}::uuid AND program_id = ${programId}::uuid
      ORDER BY step_kind
    `;
    const metrics = await this.database.sql`
      SELECT count(*) FILTER (WHERE a.status <> 'cancelled')::int AS admitted,
             count(*) FILTER (WHERE a.status = 'admitted')::int AS open_admissions,
             count(*) FILTER (WHERE r.status = 'completed')::int AS completed_reviews,
             count(*) FILTER (WHERE r.status = 'pending')::int AS pending_reviews
      FROM supervised_pilot_admissions a
      LEFT JOIN supervised_pilot_human_reviews r
        ON r.organization_id = a.organization_id AND r.admission_id = a.id
      WHERE a.organization_id = ${organizationId}::uuid AND a.program_id = ${programId}::uuid
    `;
    const program = programs[0];
    const now = Date.now();
    const approved = approvals.length === SUPERVISED_PILOT_APPROVAL_KINDS.length
      && approvals.every((row) => String(row.status) === "approved");
    return {
      ...this.programView(program),
      lifecycleStage: String(program.lifecycle_stage),
      systemFeatureEnabled: this.runtimeGate.isEnabled(),
      approvals,
      metrics: {
        admitted: Number(metrics[0]?.admitted ?? 0),
        openAdmissions: Number(metrics[0]?.open_admissions ?? 0),
        completedReviews: Number(metrics[0]?.completed_reviews ?? 0),
        pendingReviews: Number(metrics[0]?.pending_reviews ?? 0),
      },
      readiness: {
        approvalsComplete: approved,
        releaseStageEligible: String(program.lifecycle_stage) === "SUPERVISED_PILOT",
        systemFeatureEnabled: this.runtimeGate.isEnabled(),
        programFeatureEnabled: program.feature_enabled === true,
        withinTimeWindow:
          now >= new Date(String(program.starts_at)).getTime() && now <= new Date(String(program.ends_at)).getTime(),
        humanReviewRequired: true,
        aiFinalDecisionProhibited: true,
      },
    };
  }

  private async transitionActiveProgram(programId: string, target: "paused" | "revoked" | "completed") {
    const organizationId = this.tenantContext.require().organizationId;
    const userId = actorId(this.authContext);
    return this.database.sql.begin(async (tx) => {
      const rows = await tx`
        SELECT status
        FROM supervised_pilot_programs
        WHERE organization_id = ${organizationId}::uuid AND id = ${programId}::uuid
        FOR UPDATE
      `;
      if (!rows[0]) throw new NotFoundException("Pilot program not found");
      const current = String(rows[0].status);
      if (target === "paused" && current !== "active") throw new BadRequestException("Only active pilot programs can be paused");
      if (target !== "paused" && !["active", "paused", "approved", "pending_approval"].includes(current)) {
        throw new BadRequestException(`Pilot program cannot transition from ${current} to ${target}`);
      }
      const result = await tx`
        UPDATE supervised_pilot_programs
        SET status = ${target},
            feature_enabled = CASE WHEN ${target} IN ('revoked', 'completed') THEN false ELSE feature_enabled END,
            paused_by_user_id = CASE WHEN ${target} = 'paused' THEN ${userId}::uuid ELSE paused_by_user_id END,
            paused_at = CASE WHEN ${target} = 'paused' THEN now() ELSE paused_at END,
            revoked_by_user_id = CASE WHEN ${target} = 'revoked' THEN ${userId}::uuid ELSE revoked_by_user_id END,
            revoked_at = CASE WHEN ${target} = 'revoked' THEN now() ELSE revoked_at END,
            completed_by_user_id = CASE WHEN ${target} = 'completed' THEN ${userId}::uuid ELSE completed_by_user_id END,
            completed_at = CASE WHEN ${target} = 'completed' THEN now() ELSE completed_at END,
            updated_at = now()
        WHERE organization_id = ${organizationId}::uuid AND id = ${programId}::uuid
        RETURNING id::text, status, feature_enabled
      `;
      return {
        id: String(result[0]?.id),
        status: String(result[0]?.status),
        featureEnabled: Boolean(result[0]?.feature_enabled),
      };
    });
  }

  private async assertAllApprovalsWithTx(tx: Sql, organizationId: string, programId: string) {
    const rows = await tx`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE status = 'approved')::int AS approved
      FROM supervised_pilot_approval_steps
      WHERE organization_id = ${organizationId}::uuid AND program_id = ${programId}::uuid
    `;
    if (
      Number(rows[0]?.total ?? 0) !== SUPERVISED_PILOT_APPROVAL_KINDS.length ||
      Number(rows[0]?.approved ?? 0) !== SUPERVISED_PILOT_APPROVAL_KINDS.length
    ) {
      throw new BadRequestException("All supervised pilot approval steps must be approved");
    }
  }

  private async assertActiveMember(userId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      SELECT 1
      FROM memberships
      WHERE organization_id = ${organizationId}::uuid AND user_id = ${userId}::uuid AND status = 'active'
      LIMIT 1
    `;
    if (!rows[0]) throw new BadRequestException(`User ${userId} is not an active organization member`);
  }

  private async assertActiveMemberWithTx(tx: Sql, userId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await tx`
      SELECT 1
      FROM memberships
      WHERE organization_id = ${organizationId}::uuid AND user_id = ${userId}::uuid AND status = 'active'
      LIMIT 1
    `;
    if (!rows[0]) throw new BadRequestException(`User ${userId} is not an active organization member`);
  }

  private programView(row: Record<string, unknown> | undefined) {
    if (!row) throw new Error("Pilot program row is required");
    return {
      id: String(row.id),
      releaseUnitId: String(row.release_unit_id),
      name: String(row.name),
      status: String(row.status),
      featureEnabled: Boolean(row.feature_enabled),
      maxTotalInterviews: Number(row.max_total_interviews),
      maxConcurrentInterviews: Number(row.max_concurrent_interviews),
      maxInterviewsPerCandidate: Number(row.max_interviews_per_candidate),
      startsAt: new Date(String(row.starts_at)).toISOString(),
      endsAt: new Date(String(row.ends_at)).toISOString(),
      defaultReviewOwnerUserId: String(row.default_review_owner_user_id),
      incidentOwnerUserId: String(row.incident_owner_user_id),
      supportContact: String(row.support_contact),
      createdAt: new Date(String(row.created_at)).toISOString(),
      humanReviewRequired: true,
      aiFinalDecisionProhibited: true,
    };
  }
}

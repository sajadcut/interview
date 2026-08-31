import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import {
  evaluateInterviewRelease,
  type InterviewLifecycleStage,
} from "./interview-release.policy";

@Injectable()
export class InterviewsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async getReview(sessionId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const sessions = await this.database.sql`
      SELECT
        s.id,
        s.status,
        s.current_criterion_key,
        s.remaining_seconds,
        s.reconnect_count,
        s.started_at,
        s.completed_at,
        p.id AS plan_id,
        p.version AS plan_version,
        p.language,
        p.interview_type,
        p.time_budget_minutes,
        r.lifecycle_stage,
        r.interviewer_policy_version,
        r.speech_avatar_stack_version,
        r.evaluator_version,
        a.candidate_id,
        a.job_id
      FROM interview_sessions s
      JOIN interview_plans p
        ON p.organization_id = s.organization_id AND p.id = s.interview_plan_id
      JOIN interview_release_units r
        ON r.organization_id = p.organization_id AND r.id = p.release_unit_id
      JOIN applications a
        ON a.organization_id = s.organization_id AND a.id = s.application_id
      WHERE s.organization_id = ${organizationId}::uuid
        AND s.id = ${sessionId}::uuid
      LIMIT 1
    `;
    if (!sessions.length) return null;

    const transcript = await this.database.sql`
      SELECT id, speaker, start_ms, end_ms, text, is_final, stt_confidence
      FROM interview_transcript_segments
      WHERE organization_id = ${organizationId}::uuid
        AND interview_session_id = ${sessionId}::uuid
      ORDER BY start_ms
    `;

    const evidence = await this.database.sql`
      SELECT id, criterion_id, turn_id, transcript_segment_ids, summary, confidence, created_at
      FROM interview_evidence
      WHERE organization_id = ${organizationId}::uuid
        AND interview_session_id = ${sessionId}::uuid
      ORDER BY created_at
    `;

    const evaluations = await this.database.sql`
      SELECT id, rubric_version_id, evaluator_version, status, criterion_results, recommendation,
             evaluator_trace_reference, human_review_state, created_at
      FROM interview_evaluations
      WHERE organization_id = ${organizationId}::uuid
        AND interview_session_id = ${sessionId}::uuid
      ORDER BY created_at DESC
    `;

    return {
      session: sessions[0],
      transcript,
      evidence,
      evaluations,
      safetyNotice:
        "Interview evaluation is decision support. Final hiring/rejection authority remains human-controlled.",
    };
  }

  async preflightRelease(releaseUnitId: string, body: unknown) {
    if (!body || typeof body !== "object") throw new Error("Release preflight input is required");
    const value = body as Record<string, unknown>;
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      SELECT lifecycle_stage, production_approved_at, production_approved_by_user_id
      FROM interview_release_units
      WHERE organization_id = ${organizationId}::uuid
        AND id = ${releaseUnitId}::uuid
      LIMIT 1
    `;
    if (!rows.length) throw new Error("Interview release unit not found");

    const row = rows[0];
    return evaluateInterviewRelease({
      lifecycleStage: String(row?.lifecycle_stage) as InterviewLifecycleStage,
      productionApprovedAt: row?.production_approved_at ? String(row.production_approved_at) : null,
      productionApprovedByUserId: row?.production_approved_by_user_id
        ? String(row.production_approved_by_user_id)
        : null,
      candidateIsRealCustomerCandidate: value.candidateIsRealCustomerCandidate === true,
      synchronousHumanSupervisorPresent: value.synchronousHumanSupervisorPresent === true,
    });
  }
}

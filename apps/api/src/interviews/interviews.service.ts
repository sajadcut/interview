import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import {
  CandidateIntents,
  validateStructuredInterviewTurn,
  type CandidateIntent,
  type StructuredInterviewTurn,
} from "./interview-contracts";
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

  async createSession(body: unknown) {
    if (!body || typeof body !== "object") throw new Error("Interview session input is required");
    const value = body as Record<string, unknown>;
    for (const key of ["applicationId", "interviewPlanId", "consentRecordId"] as const) {
      if (typeof value[key] !== "string" || !value[key].trim()) throw new Error(`${key} is required`);
    }

    const organizationId = this.tenantContext.require().organizationId;
    const applicationId = String(value.applicationId);
    const interviewPlanId = String(value.interviewPlanId);
    const consentRecordId = String(value.consentRecordId);

    const planRows = await this.database.sql`
      SELECT
        p.id,
        p.version,
        p.time_budget_minutes,
        r.lifecycle_stage,
        r.production_approved_at,
        r.production_approved_by_user_id
      FROM interview_plans p
      JOIN interview_release_units r
        ON r.organization_id = p.organization_id AND r.id = p.release_unit_id
      JOIN applications a
        ON a.organization_id = p.organization_id AND a.id = ${applicationId}::uuid AND a.job_id = p.job_id
      WHERE p.organization_id = ${organizationId}::uuid
        AND p.id = ${interviewPlanId}::uuid
        AND p.status = 'published'
      LIMIT 1
    `;
    if (!planRows.length) throw new Error("Published interview plan not found for application");

    const consentRows = await this.database.sql`
      SELECT id, recording_allowed, transcript_allowed
      FROM consent_records
      WHERE organization_id = ${organizationId}::uuid
        AND id = ${consentRecordId}::uuid
        AND application_id = ${applicationId}::uuid
        AND purpose = 'ai_interview'
        AND withdrawn_at IS NULL
      LIMIT 1
    `;
    if (!consentRows.length) throw new Error("Active AI interview consent is required");
    if (consentRows[0]?.transcript_allowed !== true) throw new Error("Transcript consent is required for evidence-backed interviewing");

    const plan = planRows[0];
    const release = evaluateInterviewRelease({
      lifecycleStage: String(plan?.lifecycle_stage) as InterviewLifecycleStage,
      productionApprovedAt: plan?.production_approved_at ? String(plan.production_approved_at) : null,
      productionApprovedByUserId: plan?.production_approved_by_user_id
        ? String(plan.production_approved_by_user_id)
        : null,
      candidateIsRealCustomerCandidate: value.candidateIsRealCustomerCandidate === true,
      synchronousHumanSupervisorPresent: value.synchronousHumanSupervisorPresent === true,
    });
    if (!release.allowed) throw new Error(`Interview release blocked: ${release.reasons.join("; ")}`);

    const remainingSeconds = Number(plan?.time_budget_minutes) * 60;
    const rows = await this.database.sql`
      INSERT INTO interview_sessions (
        organization_id,
        application_id,
        interview_plan_id,
        status,
        remaining_seconds,
        checkpoint
      ) VALUES (
        ${organizationId}::uuid,
        ${applicationId}::uuid,
        ${interviewPlanId}::uuid,
        'invited',
        ${remainingSeconds},
        ${this.database.sql.json({
          consentRecordId,
          releaseMode: release.mode,
          releaseReasons: release.reasons,
          candidateIsRealCustomerCandidate: value.candidateIsRealCustomerCandidate === true,
        } as never)}
      )
      RETURNING id, status
    `;

    return {
      id: String(rows[0]?.id),
      status: String(rows[0]?.status),
      lifecycleStage: String(plan?.lifecycle_stage),
      releaseMode: release.mode,
      planVersion: Number(plan?.version),
      remainingSeconds,
    };
  }

  async appendTurn(sessionId: string, body: unknown) {
    if (!body || typeof body !== "object") throw new Error("Interview turn input is required");
    const value = body as Record<string, unknown>;
    if (typeof value.action !== "string") throw new Error("action is required");
    if (typeof value.objective !== "string") throw new Error("objective is required");
    if (typeof value.spokenText !== "string") throw new Error("spokenText is required");
    if (!Array.isArray(value.expectedEvidence) || !value.expectedEvidence.every((item) => typeof item === "string")) {
      throw new Error("expectedEvidence must be a string array");
    }

    const turn: StructuredInterviewTurn = {
      action: value.action as StructuredInterviewTurn["action"],
      criterion: typeof value.criterion === "string" ? value.criterion : null,
      objective: value.objective,
      spokenText: value.spokenText,
      expectedEvidence: value.expectedEvidence,
    };
    validateStructuredInterviewTurn(turn);

    let candidateIntent: CandidateIntent | null = null;
    if (typeof value.candidateIntent === "string") {
      if (!CandidateIntents.includes(value.candidateIntent as CandidateIntent)) throw new Error("Unsupported candidate intent");
      candidateIntent = value.candidateIntent as CandidateIntent;
    }

    const organizationId = this.tenantContext.require().organizationId;
    return this.database.sql.begin(async (transaction) => {
      const sessions = await transaction`
        SELECT id
        FROM interview_sessions
        WHERE organization_id = ${organizationId}::uuid AND id = ${sessionId}::uuid
        FOR UPDATE
      `;
      if (!sessions.length) throw new Error("Interview session not found");

      const sequenceRows = await transaction`
        SELECT COALESCE(max(sequence), -1)::int + 1 AS next_sequence
        FROM interview_turns
        WHERE organization_id = ${organizationId}::uuid AND interview_session_id = ${sessionId}::uuid
      `;
      const sequence = Number(sequenceRows[0]?.next_sequence ?? 0);
      const rows = await transaction`
        INSERT INTO interview_turns (
          organization_id,
          interview_session_id,
          sequence,
          candidate_intent,
          action,
          criterion_key,
          objective,
          spoken_text,
          expected_evidence,
          finalized
        ) VALUES (
          ${organizationId}::uuid,
          ${sessionId}::uuid,
          ${sequence},
          ${candidateIntent},
          ${turn.action},
          ${turn.criterion},
          ${turn.objective},
          ${turn.spokenText.trim()},
          ${this.database.sql.json(turn.expectedEvidence as never)},
          true
        )
        RETURNING id, sequence, created_at
      `;
      await transaction`
        UPDATE interview_sessions
        SET current_criterion_key = ${turn.criterion}, updated_at = now()
        WHERE organization_id = ${organizationId}::uuid AND id = ${sessionId}::uuid
      `;
      return {
        id: String(rows[0]?.id),
        sequence,
        action: turn.action,
        criterion: turn.criterion,
        objective: turn.objective,
        spokenText: turn.spokenText.trim(),
        expectedEvidence: turn.expectedEvidence,
        ...(candidateIntent ? { candidateIntent } : {}),
        finalized: true,
        createdAt: new Date(String(rows[0]?.created_at)).toISOString(),
      };
    });
  }

  async appendTranscriptSegment(sessionId: string, body: unknown) {
    if (!body || typeof body !== "object") throw new Error("Transcript segment is required");
    const value = body as Record<string, unknown>;
    if (!["candidate", "interviewer", "system"].includes(String(value.speaker))) throw new Error("Unsupported speaker");
    if (typeof value.startMs !== "number" || value.startMs < 0) throw new Error("startMs must be >= 0");
    if (typeof value.endMs !== "number" || value.endMs < value.startMs) throw new Error("endMs must be >= startMs");
    if (typeof value.text !== "string" || !value.text.trim()) throw new Error("text is required");
    if (value.sttConfidence !== undefined && (typeof value.sttConfidence !== "number" || value.sttConfidence < 0 || value.sttConfidence > 1)) {
      throw new Error("sttConfidence must be between 0 and 1");
    }

    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      INSERT INTO interview_transcript_segments (
        organization_id, interview_session_id, speaker, start_ms, end_ms, text, is_final, stt_confidence
      ) VALUES (
        ${organizationId}::uuid,
        ${sessionId}::uuid,
        ${String(value.speaker)},
        ${value.startMs},
        ${value.endMs},
        ${value.text.trim()},
        ${value.isFinal !== false},
        ${typeof value.sttConfidence === "number" ? value.sttConfidence : null}
      )
      RETURNING id, speaker, start_ms, end_ms, text, is_final, stt_confidence, created_at
    `;
    const row = rows[0];
    return {
      id: String(row?.id),
      speaker: String(row?.speaker),
      startMs: Number(row?.start_ms),
      endMs: Number(row?.end_ms),
      text: String(row?.text),
      isFinal: Boolean(row?.is_final),
      ...(row?.stt_confidence !== null ? { sttConfidence: Number(row?.stt_confidence) } : {}),
      createdAt: new Date(String(row?.created_at)).toISOString(),
    };
  }

  async recordEvidence(sessionId: string, body: unknown) {
    if (!body || typeof body !== "object") throw new Error("Interview evidence is required");
    const value = body as Record<string, unknown>;
    if (typeof value.summary !== "string" || !value.summary.trim()) throw new Error("summary is required");
    if (!Array.isArray(value.transcriptSegmentIds) || !value.transcriptSegmentIds.every((item) => typeof item === "string")) {
      throw new Error("transcriptSegmentIds must be a string array");
    }
    if (value.confidence !== undefined && (typeof value.confidence !== "number" || value.confidence < 0 || value.confidence > 1)) {
      throw new Error("confidence must be between 0 and 1");
    }

    const organizationId = this.tenantContext.require().organizationId;
    for (const segmentId of value.transcriptSegmentIds) {
      const segment = await this.database.sql`
        SELECT id
        FROM interview_transcript_segments
        WHERE organization_id = ${organizationId}::uuid
          AND interview_session_id = ${sessionId}::uuid
          AND id = ${segmentId}::uuid
        LIMIT 1
      `;
      if (!segment.length) throw new Error(`Transcript segment ${segmentId} does not belong to interview session`);
    }

    const rows = await this.database.sql`
      INSERT INTO interview_evidence (
        organization_id,
        interview_session_id,
        criterion_id,
        turn_id,
        transcript_segment_ids,
        summary,
        confidence
      ) VALUES (
        ${organizationId}::uuid,
        ${sessionId}::uuid,
        ${typeof value.criterionId === "string" ? value.criterionId : null}::uuid,
        ${typeof value.turnId === "string" ? value.turnId : null}::uuid,
        ${value.transcriptSegmentIds}::uuid[],
        ${value.summary.trim()},
        ${typeof value.confidence === "number" ? value.confidence : null}
      )
      RETURNING id, criterion_id, turn_id, transcript_segment_ids, summary, confidence, created_at
    `;
    const row = rows[0];
    return {
      id: String(row?.id),
      ...(row?.criterion_id ? { criterionId: String(row.criterion_id) } : {}),
      ...(row?.turn_id ? { turnId: String(row.turn_id) } : {}),
      transcriptSegmentIds: Array.isArray(row?.transcript_segment_ids)
        ? row.transcript_segment_ids.map(String)
        : [],
      summary: String(row?.summary),
      ...(row?.confidence !== null ? { confidence: Number(row?.confidence) } : {}),
      createdAt: new Date(String(row?.created_at)).toISOString(),
    };
  }

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

import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import { CandidateIntents, validateStructuredInterviewTurn, type CandidateIntent, type StructuredInterviewTurn } from "./interview-contracts";
import { assertInterviewTurnPolicy } from "./interview-policy-firewall";
import { evaluateInterviewRelease, type InterviewLifecycleStage } from "./interview-release.policy";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function strategyObjective(questionStrategy: unknown, criterionKey: string, fallback: string): string {
  const root = asRecord(questionStrategy); const criteria = asRecord(root.criteria); const item = asRecord(criteria[criterionKey]);
  return typeof item.objective === "string" && item.objective.trim() ? item.objective.trim() : fallback;
}
function approvalInput(row: Record<string, unknown>) {
  return {
    approvalStatus: row.approval_status ? String(row.approval_status) : null,
    approvedAt: row.approved_at ? String(row.approved_at) : null,
    approvedByUserId: row.approved_by_user_id ? String(row.approved_by_user_id) : null,
    approvalExpiresAt: row.approval_expires_at ? String(row.approval_expires_at) : null,
    materialFingerprint: row.material_fingerprint ? String(row.material_fingerprint) : null,
    approvedMaterialFingerprint: row.approved_material_fingerprint ? String(row.approved_material_fingerprint) : null,
    approvalArtifactComplete: row.approval_artifact_complete === true,
  };
}

@Injectable()
export class InterviewsService {
  constructor(private readonly database: DatabaseService, private readonly tenantContext: TenantContextService) {}

  async createSession(body: unknown) {
    if (!body || typeof body !== "object") throw new Error("Interview session input is required");
    const value = body as Record<string, unknown>;
    for (const key of ["applicationId", "interviewPlanId", "consentRecordId"] as const) {
      if (typeof value[key] !== "string" || !value[key].trim()) throw new Error(`${key} is required`);
    }
    const organizationId = this.tenantContext.require().organizationId;
    const applicationId = String(value.applicationId); const interviewPlanId = String(value.interviewPlanId); const consentRecordId = String(value.consentRecordId);
    const planRows = await this.database.sql`
      SELECT p.id, p.version, p.time_budget_minutes,
        r.lifecycle_stage, r.production_approved_at, r.production_approved_by_user_id,
        r.approval_status, r.approved_at, r.approved_by_user_id, r.approval_expires_at,
        r.material_fingerprint, r.approved_material_fingerprint,
        (r.rubric_version IS NOT NULL AND r.prompt_version_family IS NOT NULL AND r.validation_dataset_version IS NOT NULL
          AND r.calibration_report_reference IS NOT NULL AND r.security_review_reference IS NOT NULL
          AND r.privacy_compliance_review_reference IS NOT NULL
          AND jsonb_typeof(r.rollback_conditions)='array' AND jsonb_array_length(r.rollback_conditions)>0
          AND jsonb_typeof(r.suspension_conditions)='array' AND jsonb_array_length(r.suspension_conditions)>0) AS approval_artifact_complete
      FROM interview_plans p
      JOIN interview_release_units r ON r.organization_id=p.organization_id AND r.id=p.release_unit_id
      JOIN applications a ON a.organization_id=p.organization_id AND a.id=${applicationId}::uuid AND a.job_id=p.job_id
      WHERE p.organization_id=${organizationId}::uuid AND p.id=${interviewPlanId}::uuid AND p.status='published' LIMIT 1`;
    if (!planRows.length) throw new Error("Published interview plan not found for application");
    const consentRows = await this.database.sql`
      SELECT id, recording_allowed, transcript_allowed FROM consent_records
      WHERE organization_id=${organizationId}::uuid AND id=${consentRecordId}::uuid AND application_id=${applicationId}::uuid
        AND purpose='ai_interview' AND withdrawn_at IS NULL LIMIT 1`;
    if (!consentRows.length) throw new Error("Active AI interview consent is required");
    if (consentRows[0]?.transcript_allowed !== true) throw new Error("Transcript consent is required for evidence-backed interviewing");
    const plan = planRows[0] as Record<string, unknown>;
    const release = evaluateInterviewRelease({
      lifecycleStage: String(plan.lifecycle_stage) as InterviewLifecycleStage,
      productionApprovedAt: plan.production_approved_at ? String(plan.production_approved_at) : null,
      productionApprovedByUserId: plan.production_approved_by_user_id ? String(plan.production_approved_by_user_id) : null,
      candidateIsRealCustomerCandidate: value.candidateIsRealCustomerCandidate === true,
      synchronousHumanSupervisorPresent: value.synchronousHumanSupervisorPresent === true,
      ...approvalInput(plan),
    });
    if (!release.allowed) throw new Error(`Interview release blocked: ${release.reasons.join("; ")}`);
    const remainingSeconds = Number(plan.time_budget_minutes) * 60;
    const rows = await this.database.sql`
      INSERT INTO interview_sessions(organization_id,application_id,interview_plan_id,status,remaining_seconds,checkpoint)
      VALUES(${organizationId}::uuid,${applicationId}::uuid,${interviewPlanId}::uuid,'invited',${remainingSeconds},
        ${this.database.sql.json({ consentRecordId, releaseMode: release.mode, releaseReasons: release.reasons, candidateIsRealCustomerCandidate: value.candidateIsRealCustomerCandidate === true } as never)})
      RETURNING id,status`;
    return { id:String(rows[0]?.id), status:String(rows[0]?.status), lifecycleStage:String(plan.lifecycle_stage), releaseMode:release.mode, planVersion:Number(plan.version), remainingSeconds };
  }

  async appendTurn(sessionId: string, body: unknown) {
    if (!body || typeof body !== "object") throw new Error("Interview turn input is required");
    const value = body as Record<string, unknown>;
    if (typeof value.action !== "string" || typeof value.objective !== "string" || typeof value.spokenText !== "string") throw new Error("action, objective and spokenText are required");
    if (!Array.isArray(value.expectedEvidence) || !value.expectedEvidence.every((item) => typeof item === "string")) throw new Error("expectedEvidence must be a string array");
    const turn: StructuredInterviewTurn = { action:value.action as StructuredInterviewTurn["action"], criterion:typeof value.criterion === "string" ? value.criterion : null, objective:value.objective, spokenText:value.spokenText, expectedEvidence:value.expectedEvidence };
    validateStructuredInterviewTurn(turn);
    let candidateIntent: CandidateIntent | null = null;
    if (typeof value.candidateIntent === "string") { if (!CandidateIntents.includes(value.candidateIntent as CandidateIntent)) throw new Error("Unsupported candidate intent"); candidateIntent=value.candidateIntent as CandidateIntent; }
    const organizationId = this.tenantContext.require().organizationId;
    return this.database.sql.begin(async (transaction) => {
      const sessions = await transaction`
        SELECT s.id,s.remaining_seconds,p.rubric_version_id,p.question_strategy,p.forbidden_topics
        FROM interview_sessions s JOIN interview_plans p ON p.organization_id=s.organization_id AND p.id=s.interview_plan_id
        WHERE s.organization_id=${organizationId}::uuid AND s.id=${sessionId}::uuid FOR UPDATE OF s`;
      if (!sessions[0]) throw new Error("Interview session not found");
      const session=sessions[0];
      const criterionRows = await transaction`
        SELECT criterion_key,description FROM rubric_criteria
        WHERE organization_id=${organizationId}::uuid AND rubric_version_id=${String(session.rubric_version_id)}::uuid ORDER BY display_order,criterion_key`;
      const criteria = criterionRows.map((row) => ({ key:String(row.criterion_key), objective:strategyObjective(session.question_strategy,String(row.criterion_key),String(row.description ?? `validate_${String(row.criterion_key)}`)) }));
      const prior = await transaction`
        SELECT action,criterion_key,objective,spoken_text FROM interview_turns
        WHERE organization_id=${organizationId}::uuid AND interview_session_id=${sessionId}::uuid ORDER BY sequence`;
      assertInterviewTurnPolicy(turn, {
        criteria, forbiddenTopics:session.forbidden_topics,
        priorTurns:prior.map((row) => ({ action:String(row.action), criterion:row.criterion_key ? String(row.criterion_key) : null, objective:row.objective ? String(row.objective) : null, spokenText:String(row.spoken_text ?? "") })),
        remainingSeconds:Math.max(0,Number(session.remaining_seconds ?? 0)), candidateIntent, latestCandidateText:"",
      });
      const sequenceRows = await transaction`SELECT COALESCE(max(sequence),-1)::int+1 AS next_sequence FROM interview_turns WHERE organization_id=${organizationId}::uuid AND interview_session_id=${sessionId}::uuid`;
      const sequence=Number(sequenceRows[0]?.next_sequence ?? 0);
      const rows = await transaction`
        INSERT INTO interview_turns(organization_id,interview_session_id,sequence,candidate_intent,action,criterion_key,objective,spoken_text,expected_evidence,interviewer_trace_reference,finalized)
        VALUES(${organizationId}::uuid,${sessionId}::uuid,${sequence},${candidateIntent},${turn.action},${turn.criterion},${turn.objective},${turn.spokenText.trim()},${this.database.sql.json(turn.expectedEvidence as never)},'interview-policy-firewall-v1',true)
        RETURNING id,sequence,created_at`;
      await transaction`UPDATE interview_sessions SET current_criterion_key=${turn.criterion},updated_at=now() WHERE organization_id=${organizationId}::uuid AND id=${sessionId}::uuid`;
      return { id:String(rows[0]?.id),sequence,action:turn.action,criterion:turn.criterion,objective:turn.objective,spokenText:turn.spokenText.trim(),expectedEvidence:turn.expectedEvidence,...(candidateIntent?{candidateIntent}:{}),finalized:true,createdAt:new Date(String(rows[0]?.created_at)).toISOString() };
    });
  }

  async appendTranscriptSegment(sessionId: string, body: unknown) {
    if (!body || typeof body !== "object") throw new Error("Transcript segment is required");
    const value=body as Record<string, unknown>;
    if (!["candidate","interviewer","system"].includes(String(value.speaker))) throw new Error("Unsupported speaker");
    if (typeof value.startMs !== "number" || value.startMs < 0) throw new Error("startMs must be >= 0");
    if (typeof value.endMs !== "number" || value.endMs < value.startMs) throw new Error("endMs must be >= startMs");
    if (typeof value.text !== "string" || !value.text.trim()) throw new Error("text is required");
    if (value.sttConfidence !== undefined && (typeof value.sttConfidence !== "number" || value.sttConfidence<0 || value.sttConfidence>1)) throw new Error("sttConfidence must be between 0 and 1");
    const organizationId=this.tenantContext.require().organizationId;
    const rows=await this.database.sql`
      INSERT INTO interview_transcript_segments(organization_id,interview_session_id,speaker,start_ms,end_ms,text,is_final,stt_confidence)
      VALUES(${organizationId}::uuid,${sessionId}::uuid,${String(value.speaker)},${value.startMs},${value.endMs},${value.text.trim()},${value.isFinal!==false},${typeof value.sttConfidence === "number" ? value.sttConfidence : null})
      RETURNING id,speaker,start_ms,end_ms,text,is_final,stt_confidence,created_at`;
    const row=rows[0]; return { id:String(row?.id),speaker:String(row?.speaker),startMs:Number(row?.start_ms),endMs:Number(row?.end_ms),text:String(row?.text),isFinal:Boolean(row?.is_final),...(row?.stt_confidence!==null?{sttConfidence:Number(row?.stt_confidence)}:{}),createdAt:new Date(String(row?.created_at)).toISOString() };
  }

  async recordEvidence(sessionId: string, body: unknown) {
    if (!body || typeof body !== "object") throw new Error("Interview evidence is required");
    const value=body as Record<string, unknown>;
    if (typeof value.summary !== "string" || !value.summary.trim()) throw new Error("summary is required");
    const summary = value.summary.trim();
    if (!Array.isArray(value.transcriptSegmentIds) || value.transcriptSegmentIds.length===0 || !value.transcriptSegmentIds.every((item)=>typeof item === "string")) throw new Error("transcriptSegmentIds must be a non-empty string array");
    const segmentIds=[...new Set(value.transcriptSegmentIds.map(String))];
    if (segmentIds.length!==value.transcriptSegmentIds.length) throw new Error("transcriptSegmentIds must be unique");
    if (value.confidence!==undefined && (typeof value.confidence!=="number" || value.confidence<0 || value.confidence>1)) throw new Error("confidence must be between 0 and 1");
    const organizationId=this.tenantContext.require().organizationId;
    return this.database.sql.begin(async (tx) => {
      const segments=await tx`
        SELECT id::text,speaker,is_final FROM interview_transcript_segments
        WHERE organization_id=${organizationId}::uuid AND interview_session_id=${sessionId}::uuid AND id=ANY(${segmentIds}::uuid[])`;
      if (segments.length!==segmentIds.length) throw new Error("All transcript anchors must belong to the same tenant and interview session");
      if (segments.some((row)=>row.is_final!==true)) throw new Error("Only finalized transcript segments may anchor evaluation evidence");
      if (typeof value.turnId === "string") {
        const turn=await tx`SELECT id FROM interview_turns WHERE organization_id=${organizationId}::uuid AND interview_session_id=${sessionId}::uuid AND id=${value.turnId}::uuid LIMIT 1`;
        if (!turn[0]) throw new Error("turnId does not belong to the interview session");
      }
      if (typeof value.criterionId === "string") {
        const criterion=await tx`
          SELECT rc.id FROM interview_sessions s JOIN interview_plans p ON p.organization_id=s.organization_id AND p.id=s.interview_plan_id
          JOIN rubric_criteria rc ON rc.organization_id=p.organization_id AND rc.rubric_version_id=p.rubric_version_id AND rc.id=${value.criterionId}::uuid
          WHERE s.organization_id=${organizationId}::uuid AND s.id=${sessionId}::uuid LIMIT 1`;
        if (!criterion[0]) throw new Error("criterionId is not part of this interview plan rubric version");
      }
      const rows=await tx`
        INSERT INTO interview_evidence(organization_id,interview_session_id,criterion_id,turn_id,transcript_segment_ids,summary,confidence)
        VALUES(${organizationId}::uuid,${sessionId}::uuid,${typeof value.criterionId === "string" ? value.criterionId : null}::uuid,${typeof value.turnId === "string" ? value.turnId : null}::uuid,${segmentIds}::uuid[],${summary},${typeof value.confidence === "number" ? value.confidence : null})
        RETURNING id,criterion_id,turn_id,transcript_segment_ids,summary,confidence,source_kind,created_at`;
      const row=rows[0]; return { id:String(row?.id),...(row?.criterion_id?{criterionId:String(row.criterion_id)}:{}),...(row?.turn_id?{turnId:String(row.turn_id)}:{}),transcriptSegmentIds:Array.isArray(row?.transcript_segment_ids)?row.transcript_segment_ids.map(String):[],summary:String(row?.summary),...(row?.confidence!==null?{confidence:Number(row?.confidence)}:{}),sourceKind:String(row?.source_kind),createdAt:new Date(String(row?.created_at)).toISOString() };
    });
  }

  async getReview(sessionId: string) {
    const organizationId=this.tenantContext.require().organizationId;
    const sessions=await this.database.sql`
      SELECT s.id,s.status,s.current_criterion_key,s.remaining_seconds,s.reconnect_count,s.started_at,s.completed_at,
        p.id AS plan_id,p.version AS plan_version,p.language,p.interview_type,p.time_budget_minutes,
        r.lifecycle_stage,r.interviewer_policy_version,r.speech_avatar_stack_version,r.evaluator_version,a.candidate_id,a.job_id
      FROM interview_sessions s JOIN interview_plans p ON p.organization_id=s.organization_id AND p.id=s.interview_plan_id
      JOIN interview_release_units r ON r.organization_id=p.organization_id AND r.id=p.release_unit_id
      JOIN applications a ON a.organization_id=s.organization_id AND a.id=s.application_id
      WHERE s.organization_id=${organizationId}::uuid AND s.id=${sessionId}::uuid LIMIT 1`;
    if (!sessions.length) return null;
    const transcript=await this.database.sql`SELECT id,speaker,start_ms,end_ms,text,is_final,stt_confidence FROM interview_transcript_segments WHERE organization_id=${organizationId}::uuid AND interview_session_id=${sessionId}::uuid ORDER BY start_ms`;
    const evidence=await this.database.sql`SELECT id,criterion_id,turn_id,transcript_segment_ids,summary,confidence,source_kind,created_at FROM interview_evidence WHERE organization_id=${organizationId}::uuid AND interview_session_id=${sessionId}::uuid ORDER BY created_at`;
    const evaluations=await this.database.sql`SELECT id,rubric_version_id,evaluator_version,status,criterion_results,recommendation,evaluator_trace_reference,human_review_state,created_at FROM interview_evaluations WHERE organization_id=${organizationId}::uuid AND interview_session_id=${sessionId}::uuid ORDER BY created_at DESC`;
    return { session:sessions[0],transcript,evidence,evaluations,safetyNotice:"Interview evaluation is decision support. Final hiring/rejection authority remains human-controlled." };
  }

  async preflightRelease(releaseUnitId: string, body: unknown) {
    if (!body || typeof body !== "object") throw new Error("Release preflight input is required");
    const value=body as Record<string, unknown>; const organizationId=this.tenantContext.require().organizationId;
    const rows=await this.database.sql`
      SELECT lifecycle_stage,production_approved_at,production_approved_by_user_id,
        approval_status,approved_at,approved_by_user_id,approval_expires_at,material_fingerprint,approved_material_fingerprint,
        (rubric_version IS NOT NULL AND prompt_version_family IS NOT NULL AND validation_dataset_version IS NOT NULL
          AND calibration_report_reference IS NOT NULL AND security_review_reference IS NOT NULL AND privacy_compliance_review_reference IS NOT NULL
          AND jsonb_typeof(rollback_conditions)='array' AND jsonb_array_length(rollback_conditions)>0
          AND jsonb_typeof(suspension_conditions)='array' AND jsonb_array_length(suspension_conditions)>0) AS approval_artifact_complete
      FROM interview_release_units WHERE organization_id=${organizationId}::uuid AND id=${releaseUnitId}::uuid LIMIT 1`;
    if (!rows[0]) throw new Error("Interview release unit not found"); const row=rows[0] as Record<string, unknown>;
    return evaluateInterviewRelease({ lifecycleStage:String(row.lifecycle_stage) as InterviewLifecycleStage, productionApprovedAt:row.production_approved_at?String(row.production_approved_at):null, productionApprovedByUserId:row.production_approved_by_user_id?String(row.production_approved_by_user_id):null, candidateIsRealCustomerCandidate:value.candidateIsRealCustomerCandidate===true, synchronousHumanSupervisorPresent:value.synchronousHumanSupervisorPresent===true, ...approvalInput(row) });
  }
}

import { createHash } from "node:crypto";
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { AiJobQueueService } from "../ai/ai-job-queue.service";
import { CandidateConsentService } from "../auth/candidate-consent.service";
import {
  CandidateSessionService,
  type ResolvedCandidateSession,
} from "../auth/candidate-session.service";
import { getEnv } from "../config/env";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import { InterviewBrainService } from "./interview-brain.service";
import type { CandidateIntent } from "./interview-contracts";
import { computeInterviewClock } from "./interview-clock";
import { InterviewEvaluatorService } from "./interview-evaluator.service";
import { InterviewMediaService } from "./interview-media.service";
import { InterviewSessionStateService } from "./interview-session-state.service";
import { InterviewSpeechService } from "./interview-speech.service";
import { InterviewsService } from "./interviews.service";
import { createLiveKitJoinToken } from "./livekit-access-token";
import type { SpeechToTextContentType } from "./speech-to-text.adapter";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function estimateSpeechDurationMs(text: string): number {
  return Math.min(90_000, Math.max(1_500, Math.round(text.trim().length * 55)));
}

function transcriptRoleForTurnKind(
  turnKind: string | null | undefined,
): "introduction" | "interview" | "wrap_up" | "candidate_question" | "closing" {
  if (turnKind === "introduction") return "introduction";
  if (turnKind === "candidate_question") return "candidate_question";
  if (turnKind === "closing") return "closing";
  if (turnKind === "transition") return "wrap_up";
  return "interview";
}

function detectCandidateIntent(text: string, turnKind?: string | null): CandidateIntent {
  if (turnKind === "candidate_question") return "CANDIDATE_QUESTION";
  const normalized = text.trim().toLocaleLowerCase();
  if (
    /(?:پایان (?:مصاحبه|جلسه)|مصاحبه را تمام|نمی.?خواهم ادامه|تمامش کنیم|end (?:the )?interview|stop (?:the )?interview)/i.test(normalized)
  ) return "END_INTERVIEW_REQUEST";
  if (/(?:از این (?:سؤال|موضوع) (?:بگذریم|عبور)|نمی.?خواهم پاسخ|skip (?:this|question|topic)|prefer not to answer)/i.test(normalized)) {
    return "SKIP_REQUEST";
  }
  if (/(?:سؤال را توضیح|منظورتان چیست|متوجه سؤال نشدم|clarify|what do you mean)/i.test(normalized)) {
    return "CLARIFICATION_REQUEST";
  }
  if (/[?؟]$/.test(normalized) && /(?:موقعیت|شرکت|تیم|فرایند|استخدام|role|company|team|process|position)/i.test(normalized)) {
    return "CANDIDATE_QUESTION";
  }
  return "ANSWER";
}

function isSubstantiveCandidateEvidence(text: string): boolean {
  const normalized = text.trim();
  if (normalized.length < 24 || normalized.split(/\s+/).filter(Boolean).length < 4) return false;
  return !/^(?:نمی.?دانم|نمی.?دونم|یادم نیست|اطلاعی ندارم|نه|خیر|نمی.?خواهم پاسخ بدهم|i don'?t know|no idea|prefer not to answer)[.!؟?\s]*$/i.test(normalized);
}

@Injectable()
export class CandidateInterviewService {
  constructor(
    private readonly database: DatabaseService,
    private readonly aiJobs: AiJobQueueService,
    private readonly candidateSessions: CandidateSessionService,
    private readonly candidateConsent: CandidateConsentService,
    private readonly tenantContext: TenantContextService,
    private readonly interviews: InterviewsService,
    private readonly state: InterviewSessionStateService,
    private readonly brain: InterviewBrainService,
    private readonly evaluator: InterviewEvaluatorService,
    private readonly media: InterviewMediaService,
    private readonly speech: InterviewSpeechService,
  ) {}

  private async scope(rawToken: string | undefined): Promise<ResolvedCandidateSession> {
    const scope = await this.candidateSessions.resolve(rawToken);
    if (!scope) throw new UnauthorizedException("Candidate session is required");
    return scope;
  }

  private async requireReadyConsent(rawToken: string | undefined) {
    const status = await this.candidateConsent.status(rawToken);
    if (!status.readyForInterview) {
      throw new BadRequestException({
        message: "Candidate consent is incomplete",
        missingRequiredConsents: status.missingRequiredConsents,
      });
    }
    return status;
  }

  private async ensureInterviewConsentRecord(
    scope: ResolvedCandidateSession,
    consentStatus: Awaited<ReturnType<CandidateConsentService["status"]>>,
  ): Promise<string> {
    const rows = await this.database.sql`
      SELECT id::text
      FROM consent_records
      WHERE organization_id = ${scope.organizationId}::uuid
        AND candidate_id = ${scope.candidateId}::uuid
        AND application_id = ${scope.applicationId}::uuid
        AND purpose = 'ai_interview'
        AND withdrawn_at IS NULL
        AND transcript_allowed = true
      ORDER BY granted_at DESC
      LIMIT 1
    `;
    if (rows[0]) return String(rows[0].id);

    const receiptFingerprint = consentStatus.latest
      .map((item) => `${item.consentType}:${item.noticeVersion}:${item.granted}`)
      .sort()
      .join("|");
    const policyVersion = `candidate-${createHash("sha256").update(receiptFingerprint).digest("hex").slice(0, 16)}`;
    const recordingAllowed = consentStatus.latest.some(
      (item) => item.consentType === "recording" && item.granted,
    );
    const inserted = await this.database.sql`
      INSERT INTO consent_records (
        organization_id, candidate_id, application_id, purpose, policy_version,
        recording_allowed, transcript_allowed, granted_at, metadata
      ) VALUES (
        ${scope.organizationId}::uuid,
        ${scope.candidateId}::uuid,
        ${scope.applicationId}::uuid,
        'ai_interview',
        ${policyVersion},
        ${recordingAllowed},
        true,
        now(),
        ${this.database.sql.json({
          source: "candidate_portal_consent",
          candidateSessionId: scope.sessionId,
          receiptIds: consentStatus.latest.map((item) => item.id),
        } as never)}
      )
      RETURNING id::text
    `;
    const id = inserted[0]?.id;
    if (!id) throw new BadRequestException("Could not create AI interview consent record");
    return String(id);
  }

  private async publishedPlanId(scope: ResolvedCandidateSession): Promise<string> {
    const rows = await this.database.sql`
      SELECT p.id::text
      FROM applications a
      JOIN interview_plans p
        ON p.organization_id = a.organization_id AND p.job_id = a.job_id
      WHERE a.organization_id = ${scope.organizationId}::uuid
        AND a.id = ${scope.applicationId}::uuid
        AND a.candidate_id = ${scope.candidateId}::uuid
        AND p.status = 'published'
        AND p.interview_type <> 'human_technical'
      ORDER BY p.version DESC
      LIMIT 1
    `;
    if (!rows[0]) throw new NotFoundException("Published interview plan not found for this application");
    return String(rows[0].id);
  }

  private async assertOwnedRuntime(
    scope: ResolvedCandidateSession,
    sessionId: string,
    mediaSessionId?: string,
  ) {
    const rows = mediaSessionId
      ? await this.database.sql`
          SELECT s.status, s.started_at, s.completed_at, s.checkpoint,
                 p.time_budget_minutes, m.id::text AS media_session_id
          FROM interview_sessions s
          JOIN applications a
            ON a.organization_id = s.organization_id AND a.id = s.application_id
          JOIN interview_plans p
            ON p.organization_id = s.organization_id AND p.id = s.interview_plan_id
          JOIN interview_media_sessions m
            ON m.organization_id = s.organization_id AND m.interview_session_id = s.id
          WHERE s.organization_id = ${scope.organizationId}::uuid
            AND s.id = ${sessionId}::uuid
            AND s.application_id = ${scope.applicationId}::uuid
            AND a.candidate_id = ${scope.candidateId}::uuid
            AND m.id = ${mediaSessionId}::uuid
          LIMIT 1
        `
      : await this.database.sql`
          SELECT s.status, s.started_at, s.completed_at, s.checkpoint,
                 p.time_budget_minutes
          FROM interview_sessions s
          JOIN applications a
            ON a.organization_id = s.organization_id AND a.id = s.application_id
          JOIN interview_plans p
            ON p.organization_id = s.organization_id AND p.id = s.interview_plan_id
          WHERE s.organization_id = ${scope.organizationId}::uuid
            AND s.id = ${sessionId}::uuid
            AND s.application_id = ${scope.applicationId}::uuid
            AND a.candidate_id = ${scope.candidateId}::uuid
          LIMIT 1
        `;
    if (!rows[0]) throw new NotFoundException("Candidate interview runtime not found");
    const row = rows[0];
    const checkpoint = asRecord(row.checkpoint);
    const clock = computeInterviewClock({
      status: String(row.status),
      timeBudgetMinutes: Number(row.time_budget_minutes),
      startedAt: row.started_at ? String(row.started_at) : null,
      completedAt: row.completed_at ? String(row.completed_at) : null,
    });
    await this.database.sql`
      UPDATE interview_sessions
      SET remaining_seconds = ${clock.remainingSeconds}
      WHERE organization_id = ${scope.organizationId}::uuid
        AND id = ${sessionId}::uuid
        AND remaining_seconds IS DISTINCT FROM ${clock.remainingSeconds}
    `;
    return {
      status: String(row.status),
      remainingSeconds: clock.remainingSeconds,
      clock,
      realCandidate: checkpoint.candidateIsRealCustomerCandidate === true,
      releaseMode: typeof checkpoint.releaseMode === "string" ? checkpoint.releaseMode : "unknown",
    };
  }

  private async transcript(sessionId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      SELECT speaker, text
      FROM interview_transcript_segments
      WHERE organization_id = ${organizationId}::uuid
        AND interview_session_id = ${sessionId}::uuid
        AND is_final = true
        AND speaker IN ('candidate', 'interviewer')
      ORDER BY start_ms, created_at, id
    `;
    return rows.map((row) => ({
      speaker: String(row.speaker) as "candidate" | "interviewer",
      text: String(row.text),
    }));
  }

  private async elapsedMs(sessionId: string): Promise<number> {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      SELECT COALESCE(max(end_ms), 0)::int AS elapsed_ms
      FROM interview_transcript_segments
      WHERE organization_id = ${organizationId}::uuid
        AND interview_session_id = ${sessionId}::uuid
    `;
    return Number(rows[0]?.elapsed_ms ?? 0);
  }

  private async ensureInterviewerTranscript(
    sessionId: string,
    turn: { id: string; spokenText: string; turnKind?: string | null },
  ) {
    const organizationId = this.tenantContext.require().organizationId;
    const existing = await this.database.sql`
      SELECT id::text
      FROM interview_transcript_segments
      WHERE organization_id = ${organizationId}::uuid
        AND interview_session_id = ${sessionId}::uuid
        AND interview_turn_id = ${turn.id}::uuid
      LIMIT 1
    `;
    if (existing[0]) return;
    const elapsedMs = await this.elapsedMs(sessionId);
    const lastEndRows = await this.database.sql`
      SELECT COALESCE(max(end_ms), 0)::int AS last_end_ms
      FROM interview_transcript_segments
      WHERE organization_id = ${organizationId}::uuid
        AND interview_session_id = ${sessionId}::uuid
    `;
    const startMs = Math.max(elapsedMs, Number(lastEndRows[0]?.last_end_ms ?? 0));
    const durationMs = estimateSpeechDurationMs(turn.spokenText);
    await this.interviews.appendTranscriptSegment(sessionId, {
      speaker: "interviewer",
      startMs,
      endMs: startMs + durationMs,
      text: turn.spokenText,
      isFinal: true,
      lifecycleRole: transcriptRoleForTurnKind(turn.turnKind),
      turnId: turn.id,
    });
  }

  private async ensureIntroductionTurn(
    scope: ResolvedCandidateSession,
    sessionId: string,
  ): Promise<{
    created: boolean;
    turn: { id: string; action: string; spokenText: string; turnKind: "introduction" };
  }> {
    const organizationId = scope.organizationId;
    const result = await this.database.sql.begin(async (tx) => {
      const sessionRows = await tx`
        SELECT c.display_name, j.title AS job_title, p.time_budget_minutes
        FROM interview_sessions s
        JOIN applications a
          ON a.organization_id = s.organization_id AND a.id = s.application_id
        JOIN candidates c
          ON c.organization_id = a.organization_id AND c.id = a.candidate_id
        JOIN interview_plans p
          ON p.organization_id = s.organization_id AND p.id = s.interview_plan_id
        JOIN jobs j
          ON j.organization_id = a.organization_id AND j.id = a.job_id
        WHERE s.organization_id = ${organizationId}::uuid
          AND s.id = ${sessionId}::uuid
        FOR UPDATE OF s
      `;
      const session = sessionRows[0];
      if (!session) throw new NotFoundException("Candidate interview runtime not found");

      const existing = await tx`
        SELECT id::text, action, spoken_text
        FROM interview_turns
        WHERE organization_id = ${organizationId}::uuid
          AND interview_session_id = ${sessionId}::uuid
          AND turn_kind = 'introduction'
        LIMIT 1
      `;
      if (existing[0]) {
        return {
          created: false,
          turn: {
            id: String(existing[0].id),
            action: String(existing[0].action),
            spokenText: String(existing[0].spoken_text),
            turnKind: "introduction" as const,
          },
        };
      }

      const sequenceRows = await tx`
        SELECT COALESCE(max(sequence), -1)::int + 1 AS next_sequence
        FROM interview_turns
        WHERE organization_id = ${organizationId}::uuid
          AND interview_session_id = ${sessionId}::uuid
      `;
      const sequence = Number(sequenceRows[0]?.next_sequence ?? 0);
      const candidateName = String(session.display_name ?? "").trim() || "دوست عزیز";
      const jobTitle = String(session.job_title ?? "").trim() || "این موقعیت";
      const duration = Math.max(1, Number(session.time_budget_minutes ?? 0));
      const spokenText =
        `سلام ${candidateName}، خوش آمدید. من مصاحبه‌گر هوشمند این مرحله هستم. این مصاحبه حدود ${duration.toLocaleString("fa-IR")} دقیقه زمان دارد و درباره تجربه‌های مرتبط با موقعیت ${jobTitle} صحبت می‌کنیم. ممکن است برای روشن‌تر شدن پاسخ‌ها سؤال تکمیلی بپرسم. اگر سؤالی را متوجه نشدید می‌توانید درخواست توضیح کنید و در صورت نیاز می‌توانید از یک موضوع عبور کنید. اگر آماده‌اید شروع کنیم.`;
      const inserted = await tx`
        INSERT INTO interview_turns (
          organization_id, interview_session_id, sequence, action, criterion_key,
          objective, spoken_text, expected_evidence, interviewer_trace_reference,
          finalized, turn_kind, question_source, resume_claim_id
        ) VALUES (
          ${organizationId}::uuid, ${sessionId}::uuid, ${sequence}, 'transition', NULL,
          'interview_introduction', ${spokenText}, ${tx.json([] as never)},
          'deterministic-lifecycle:introduction:v1', true, 'introduction', 'lifecycle', NULL
        )
        RETURNING id::text, action, spoken_text
      `;
      await tx`
        UPDATE interview_sessions
        SET checkpoint = checkpoint || ${tx.json({
          lifecycle: { phase: "introduction", introductionRecorded: true },
        } as never)}::jsonb,
            updated_at = now()
        WHERE organization_id = ${organizationId}::uuid
          AND id = ${sessionId}::uuid
      `;
      return {
        created: true,
        turn: {
          id: String(inserted[0]?.id),
          action: String(inserted[0]?.action),
          spokenText: String(inserted[0]?.spoken_text),
          turnKind: "introduction" as const,
        },
      };
    });
    await this.ensureInterviewerTranscript(sessionId, result.turn);
    return result;
  }

  private async currentOrFirstTurn(sessionId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      SELECT id::text, action, criterion_key, objective, spoken_text, finalized,
             turn_kind, question_source, resume_claim_id::text
      FROM interview_turns
      WHERE organization_id = ${organizationId}::uuid
        AND interview_session_id = ${sessionId}::uuid
        AND finalized = true
        AND turn_kind <> 'introduction'
      ORDER BY sequence DESC
      LIMIT 1
    `;
    if (rows[0]) {
      const turn = {
        id: String(rows[0].id),
        action: String(rows[0].action),
        criterion: rows[0].criterion_key ? String(rows[0].criterion_key) : null,
        objective: String(rows[0].objective ?? ""),
        spokenText: String(rows[0].spoken_text),
        turnKind: String(rows[0].turn_kind ?? "planned_criterion"),
        questionSource: String(rows[0].question_source ?? "rubric"),
        resumeClaimId: rows[0].resume_claim_id ? String(rows[0].resume_claim_id) : null,
      };
      await this.ensureInterviewerTranscript(sessionId, turn);
      return turn;
    }

    const turn = await this.brain.nextTurn(sessionId, { elapsedSeconds: 0 });
    await this.ensureInterviewerTranscript(sessionId, turn);
    return turn;
  }

  private async issueCandidateConnection(
    scope: ResolvedCandidateSession,
    sessionId: string,
    mediaSessionId: string,
  ) {
    const runtime = await this.assertOwnedRuntime(scope, sessionId, mediaSessionId);
    const rows = await this.database.sql`
      SELECT mode, status, transport_provider, room_reference
      FROM interview_media_sessions
      WHERE organization_id = ${scope.organizationId}::uuid
        AND id = ${mediaSessionId}::uuid
        AND interview_session_id = ${sessionId}::uuid
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) throw new NotFoundException("Interview media session not found");
    if (["ended", "failed"].includes(String(row.status))) {
      throw new BadRequestException(`Interview media session is ${String(row.status)}`);
    }
    if (String(row.transport_provider) !== "livekit") {
      throw new BadRequestException("Candidate interview requires LiveKit transport");
    }
    const mode = String(row.mode);
    if (mode !== "audio" && mode !== "avatar") throw new BadRequestException("Unsupported media mode");
    const readiness = await this.media.getReadiness(mode);
    if (!readiness.ready) {
      throw new BadRequestException({
        message: "Realtime interview providers are not ready",
        blockers: readiness.blockers,
      });
    }
    const roomReference = String(row.room_reference ?? "");
    if (!roomReference) throw new BadRequestException("Interview media room is missing");
    const env = getEnv();
    if (!env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) {
      throw new BadRequestException("LiveKit is not configured");
    }
    const liveKitUrl = new URL(env.LIVEKIT_URL);
    if (!["ws:", "wss:"].includes(liveKitUrl.protocol)) {
      throw new BadRequestException("LIVEKIT_URL must use ws:// or wss:// for browser transport");
    }
    const credential = createLiveKitJoinToken({
      apiKey: env.LIVEKIT_API_KEY,
      apiSecret: env.LIVEKIT_API_SECRET,
      room: roomReference,
      participantIdentity: `candidate-${mediaSessionId}`,
      validForSeconds: env.LIVEKIT_TOKEN_TTL_SECONDS,
    });
    return {
      transport: "livekit" as const,
      serverUrl: env.LIVEKIT_URL,
      roomReference,
      accessToken: credential.token,
      expiresAt: credential.expiresAt,
      participantIdentity: credential.participantIdentity,
      permissions: credential.permissions,
      releaseMode: runtime.releaseMode,
    };
  }

  async preflight(rawToken: string | undefined) {
    const scope = await this.scope(rawToken);
    await this.requireReadyConsent(rawToken);
    return this.tenantContext.run(scope.organizationId, async () => {
      const rows = await this.database.sql`
        SELECT p.time_budget_minutes, p.interview_type, p.language
        FROM applications a
        JOIN interview_plans p
          ON p.organization_id = a.organization_id AND p.job_id = a.job_id
        WHERE a.organization_id = ${scope.organizationId}::uuid
          AND a.id = ${scope.applicationId}::uuid
          AND a.candidate_id = ${scope.candidateId}::uuid
          AND p.status = 'published'
          AND p.interview_type <> 'human_technical'
        ORDER BY p.version DESC
        LIMIT 1
      `;
      const row = rows[0];
      if (!row) throw new NotFoundException("Published interview plan not found for this application");
      return {
        timeBudgetMinutes: Number(row.time_budget_minutes),
        interviewType: String(row.interview_type),
        language: String(row.language),
        clockPolicy: {
          mode: "server_wall_clock" as const,
          disconnectPolicy: "clock_continues" as const,
        },
        integrityPolicy: {
          observableSignalsOnly: true,
          automaticCheatingDecision: false,
          automaticScorePenalty: false,
          humanReviewRequiredForConcern: true,
        },
      };
    });
  }

  async start(rawToken: string | undefined, developmentPreview = false) {
    const scope = await this.scope(rawToken);
    if (developmentPreview && getEnv().NODE_ENV !== "development") {
      throw new BadRequestException("Development preview is only available in development");
    }
    const consentStatus = await this.requireReadyConsent(rawToken);

    return this.tenantContext.run(scope.organizationId, async () => {
      const consentRecordId = await this.ensureInterviewConsentRecord(scope, consentStatus);
      const interviewPlanId = await this.publishedPlanId(scope);
      const realCandidate = !developmentPreview;

      const existingRows = await this.database.sql`
        SELECT id::text, status, checkpoint
        FROM interview_sessions
        WHERE organization_id = ${scope.organizationId}::uuid
          AND application_id = ${scope.applicationId}::uuid
          AND status IN ('invited', 'scheduled', 'in_progress', 'paused', 'disconnected')
        ORDER BY created_at DESC
      `;
      const existing = existingRows.find((row) => {
        const checkpoint = asRecord(row.checkpoint);
        return (checkpoint.candidateIsRealCustomerCandidate === true) === realCandidate;
      });

      let sessionId: string;
      if (existing) {
        sessionId = String(existing.id);
      } else {
        try {
          const session = await this.interviews.createSession({
            applicationId: scope.applicationId,
            interviewPlanId,
            consentRecordId,
            candidateIsRealCustomerCandidate: realCandidate,
            synchronousHumanSupervisorPresent: false,
          });
          sessionId = session.id;
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "Candidate interview session could not be created";
          throw new BadRequestException(message);
        }
      }

      const lifecycle = await this.state.getState(sessionId);
      if (lifecycle.status === "invited" || lifecycle.status === "scheduled") {
        await this.state.transition(sessionId, {
          idempotencyKey: `candidate-start-${sessionId}`,
          action: "start",
        });
      } else if (lifecycle.status === "paused") {
        await this.state.transition(sessionId, {
          idempotencyKey: `candidate-resume-${sessionId}-${lifecycle.stateVersion}`,
          action: "resume",
        });
      } else if (lifecycle.status === "disconnected") {
        await this.state.transition(sessionId, {
          idempotencyKey: `candidate-reconnect-${sessionId}-${lifecycle.stateVersion}`,
          action: lifecycle.failure ? "recover" : "reconnect",
        });
      }

      const latestMediaSession = await this.media.getLatestMediaSession(sessionId);
      const activeMediaSessionId =
        latestMediaSession && !["ended", "failed"].includes(latestMediaSession.status)
          ? latestMediaSession.id
          : (await this.media.createMediaSession(sessionId, "audio")).id;
      const connection = await this.issueCandidateConnection(scope, sessionId, activeMediaSessionId);
      const introduction = await this.ensureIntroductionTurn(scope, sessionId);
      const turn = await this.currentOrFirstTurn(sessionId);
      let runtime = await this.assertOwnedRuntime(scope, sessionId, activeMediaSessionId);
      if (turn.action === "close") {
        runtime = await this.finishCandidateInterview(
          scope,
          sessionId,
          activeMediaSessionId,
          "brain_close",
        );
      }
      const messages = await this.transcript(sessionId);

      return {
        status: runtime.status === "completed" || turn.action === "close" ? "completed" : "active",
        lifecyclePhase: turn.turnKind === "candidate_question"
          ? "candidate_question"
          : turn.turnKind === "closing"
            ? "closing"
            : introduction.created
              ? "introduction"
              : "active",
        sessionId,
        mediaSessionId: activeMediaSessionId,
        remainingSeconds: runtime.remainingSeconds,
        clock: runtime.clock,
        developmentPreview,
        releaseMode: runtime.releaseMode,
        interviewer: {
          name: "مصاحبه‌گر هوشمند",
          subtitle: "مصاحبه ساختاریافته",
          avatarVideoAvailable: false,
        },
        ...(introduction.created
          ? {
              openingTurn: {
                id: introduction.turn.id,
                action: introduction.turn.action,
                spokenText: introduction.turn.spokenText,
              },
            }
          : {}),
        turn: {
          id: turn.id,
          action: turn.action,
          spokenText: turn.spokenText,
        },
        transcript: messages,
        connection,
        privacy: {
          rawMediaPersisted: false,
          candidateVideoAnalysis: "none",
          biometricInferenceAllowed: false,
        },
      };
    });
  }

  private async currentQuestionContext(sessionId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      SELECT t.id::text AS turn_id, t.action, t.criterion_key, t.objective,
             t.turn_kind, t.resume_claim_id::text, rc.id::text AS criterion_id
      FROM interview_turns t
      JOIN interview_sessions s
        ON s.organization_id = t.organization_id AND s.id = t.interview_session_id
      JOIN interview_plans p
        ON p.organization_id = s.organization_id AND p.id = s.interview_plan_id
      LEFT JOIN rubric_criteria rc
        ON rc.organization_id = p.organization_id
       AND rc.rubric_version_id = p.rubric_version_id
       AND rc.criterion_key = t.criterion_key
      WHERE t.organization_id = ${organizationId}::uuid
        AND t.interview_session_id = ${sessionId}::uuid
        AND t.finalized = true
      ORDER BY t.sequence DESC
      LIMIT 1
    `;
    const row = rows[0];
    return row
      ? {
          turnId: String(row.turn_id),
          action: String(row.action),
          criterionKey: row.criterion_key ? String(row.criterion_key) : null,
          criterionId: row.criterion_id ? String(row.criterion_id) : null,
          objective: row.objective ? String(row.objective) : null,
          turnKind: String(row.turn_kind ?? "planned_criterion"),
          resumeClaimId: row.resume_claim_id ? String(row.resume_claim_id) : null,
        }
      : null;
  }

  private async queueEvaluation(scope: ResolvedCandidateSession, sessionId: string) {
    const input = await this.evaluator.buildInput(sessionId);
    const idempotencyKey = `interview-evaluate:${sessionId}:${input.evaluatorVersion}`;
    const job = await this.aiJobs.enqueue({
      organizationId: scope.organizationId,
      capability: "interview.evaluate",
      idempotencyKey,
      timeoutMs: 60_000,
      maxAttempts: 3,
      payload: {
        capabilityVersion: "v1",
        input: {
          ...input,
          idempotencyKey,
        },
        inputReferences: {
          interviewSessionId: input.sessionId,
          applicationId: input.applicationId,
          rubricVersionId: input.rubricVersionId,
        },
      },
    });
    await this.database.sql`
      UPDATE interview_sessions
      SET checkpoint = checkpoint || ${this.database.sql.json({
        evaluation: {
          capability: "interview.evaluate",
          jobId: job.id,
          status: job.status,
          queuedAt: new Date().toISOString(),
        },
      } as never)}::jsonb,
          updated_at = now()
      WHERE organization_id = ${scope.organizationId}::uuid
        AND id = ${sessionId}::uuid
    `;
    return { id: job.id, status: job.status };
  }

  private async finishCandidateInterview(
    scope: ResolvedCandidateSession,
    sessionId: string,
    mediaSessionId: string,
    reason: "brain_close" | "time_budget_expired",
  ) {
    const runtime = await this.assertOwnedRuntime(scope, sessionId, mediaSessionId);
    if (!["completed", "failed", "cancelled"].includes(runtime.status)) {
      await this.state.transition(sessionId, {
        idempotencyKey: `candidate-finish:${sessionId}`,
        action: "finish",
        reason,
      });
    }
    const latestMedia = await this.media.getLatestMediaSession(sessionId);
    if (latestMedia?.id === mediaSessionId && latestMedia.status !== "ended") {
      await this.media.appendEvent(sessionId, mediaSessionId, {
        idempotencyKey: `candidate-ended:${sessionId}`,
        eventType: "ended",
        sourceComponent: "api",
        payload: { reason },
      });
    }
    const evaluationJob = await this.queueEvaluation(scope, sessionId);
    const finalRuntime = await this.assertOwnedRuntime(scope, sessionId, mediaSessionId);
    return { ...finalRuntime, evaluationJob };
  }

  private async processCandidateText(
    scope: ResolvedCandidateSession,
    sessionId: string,
    mediaSessionId: string,
    text: string,
    durationSeconds: number,
  ) {
    const runtime = await this.assertOwnedRuntime(scope, sessionId, mediaSessionId);
    if (["completed", "cancelled", "failed"].includes(runtime.status)) {
      throw new BadRequestException(`Interview session is ${runtime.status}`);
    }
    if (runtime.remainingSeconds <= 0) {
      throw new BadRequestException("Interview time budget is exhausted");
    }
    const candidateText = text.trim();
    if (!candidateText) throw new BadRequestException("Candidate answer is empty");

    const question = await this.currentQuestionContext(sessionId);
    const startMs = await this.elapsedMs(sessionId);
    const candidateDurationMs = Math.max(250, Math.round(durationSeconds * 1000));
    const candidateLifecycleRole = question?.turnKind === "candidate_question"
      ? "candidate_question"
      : "interview";
    const candidateSegment = await this.interviews.appendTranscriptSegment(sessionId, {
      speaker: "candidate",
      startMs,
      endMs: startMs + candidateDurationMs,
      text: candidateText,
      isFinal: true,
      lifecycleRole: candidateLifecycleRole,
    });
    const candidateIntent = detectCandidateIntent(candidateText, question?.turnKind);
    if (
      candidateIntent === "ANSWER" &&
      question?.criterionId &&
      question.criterionKey &&
      ["planned_criterion", "resume_validation", "adaptive_follow_up"].includes(question.turnKind) &&
      ["ask", "probe"].includes(question.action) &&
      isSubstantiveCandidateEvidence(candidateText)
    ) {
      await this.interviews.recordEvidence(sessionId, {
        criterionId: question.criterionId,
        turnId: question.turnId,
        transcriptSegmentIds: [String(candidateSegment.id)],
        summary: candidateText.slice(0, 2000),
      });
    }

    const nextTurn = await this.brain.nextTurn(sessionId, {
      latestCandidateText: candidateText,
      candidateIntent,
      elapsedSeconds: 0,
    });
    await this.ensureInterviewerTranscript(sessionId, nextTurn);
    await this.media.appendEvent(sessionId, mediaSessionId, {
      idempotencyKey: `candidate-brain:${nextTurn.id}`,
      eventType: "brain_turn",
      sourceComponent: "brain",
      payload: {
        turnId: nextTurn.id,
        action: nextTurn.action,
        criterion: nextTurn.criterion,
      },
    });

    const finalRuntime = nextTurn.action === "close"
      ? await this.finishCandidateInterview(scope, sessionId, mediaSessionId, "brain_close")
      : await this.assertOwnedRuntime(scope, sessionId, mediaSessionId);

    return {
      candidateText,
      remainingSeconds: finalRuntime.remainingSeconds,
      clock: finalRuntime.clock,
      completed: nextTurn.action === "close" || finalRuntime.status === "completed",
      lifecyclePhase: nextTurn.turnKind === "candidate_question"
        ? "candidate_question"
        : nextTurn.turnKind === "closing"
          ? "closing"
          : "active",
      turn: {
        id: nextTurn.id,
        action: nextTurn.action,
        spokenText: nextTurn.spokenText,
      },
    };
  }

  async answerText(
    rawToken: string | undefined,
    input: { sessionId: string; mediaSessionId: string; text: string },
  ) {
    const scope = await this.scope(rawToken);
    await this.requireReadyConsent(rawToken);
    return this.tenantContext.run(scope.organizationId, async () => {
      const durationSeconds = Math.max(1, Math.min(120, input.text.trim().length * 0.055));
      return this.processCandidateText(
        scope,
        input.sessionId,
        input.mediaSessionId,
        input.text,
        durationSeconds,
      );
    });
  }

  async answerAudio(
    rawToken: string | undefined,
    sessionId: string,
    mediaSessionId: string,
    audio: Uint8Array,
    contentType: SpeechToTextContentType,
  ) {
    const scope = await this.scope(rawToken);
    await this.requireReadyConsent(rawToken);
    return this.tenantContext.run(scope.organizationId, async () => {
      const runtime = await this.assertOwnedRuntime(scope, sessionId, mediaSessionId);
      const result = runtime.realCandidate
        ? await this.speech.transcribeAuthenticatedCandidateAudio(
            sessionId,
            mediaSessionId,
            audio,
            contentType,
          )
        : await this.speech.transcribeCandidateAudio(sessionId, mediaSessionId, audio, contentType);
      if (!result.speechDetected) {
        return {
          speechDetected: false as const,
          durationSeconds: result.durationSeconds,
          transcript: null,
        };
      }
      const text = result.transcript?.text.trim() ?? "";
      if (!text) {
        return {
          speechDetected: true as const,
          durationSeconds: result.durationSeconds,
          transcript: null,
        };
      }
      const turn = await this.processCandidateText(
        scope,
        sessionId,
        mediaSessionId,
        text,
        result.durationSeconds,
      );
      return {
        speechDetected: true as const,
        durationSeconds: result.durationSeconds,
        transcript: {
          text,
          language: result.transcript?.language ?? "unknown",
          provider: result.transcript?.provider ?? "stt",
        },
        ...turn,
      };
    });
  }

  async sync(
    rawToken: string | undefined,
    sessionId: string,
    mediaSessionId: string,
  ) {
    const scope = await this.scope(rawToken);
    await this.requireReadyConsent(rawToken);
    return this.tenantContext.run(scope.organizationId, async () => {
      let runtime = await this.assertOwnedRuntime(scope, sessionId, mediaSessionId);
      let turn = await this.currentOrFirstTurn(sessionId);

      const shouldEnterWrapUp =
        runtime.status === "in_progress" &&
        runtime.remainingSeconds <= 60 &&
        turn.action !== "close" &&
        turn.turnKind !== "candidate_question" &&
        turn.turnKind !== "closing";
      const shouldForceClose =
        runtime.status === "in_progress" &&
        runtime.remainingSeconds <= 0 &&
        turn.action !== "close";
      if (shouldEnterWrapUp || shouldForceClose) {
        turn = await this.brain.nextTurn(sessionId, {
          latestCandidateText: "",
          candidateIntent: "SILENCE_TIMEOUT",
          elapsedSeconds: 0,
        });
        await this.ensureInterviewerTranscript(sessionId, turn);
        if (turn.action === "close") {
          runtime = await this.finishCandidateInterview(
            scope,
            sessionId,
            mediaSessionId,
            "time_budget_expired",
          );
        }
      }

      return {
        status: ["completed", "failed", "cancelled"].includes(runtime.status) || turn.action === "close"
          ? "completed" as const
          : "active" as const,
        lifecyclePhase: turn.turnKind === "candidate_question"
          ? "candidate_question" as const
          : turn.turnKind === "closing"
            ? "closing" as const
            : "active" as const,
        sessionId,
        remainingSeconds: runtime.remainingSeconds,
        clock: runtime.clock,
        turn: {
          id: turn.id,
          action: turn.action,
          spokenText: turn.spokenText,
        },
      };
    });
  }

  async recordIntegrityEvent(
    rawToken: string | undefined,
    sessionId: string,
    mediaSessionId: string,
    body: unknown,
  ) {
    const scope = await this.scope(rawToken);
    await this.requireReadyConsent(rawToken);
    return this.tenantContext.run(scope.organizationId, async () => {
      await this.assertOwnedRuntime(scope, sessionId, mediaSessionId);
      const value = asRecord(body);
      const eventType = String(value.eventType ?? "");
      const allowed = new Set([
        "visibility_hidden",
        "visibility_visible",
        "window_blur",
        "window_focus",
        "large_paste",
        "reconnect",
      ]);
      if (!allowed.has(eventType)) throw new BadRequestException("Unsupported integrity event");
      const durationMs = value.durationMs === undefined ? null : Number(value.durationMs);
      if (durationMs !== null && (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > 86_400_000)) {
        throw new BadRequestException("durationMs is invalid");
      }
      const metadataInput = asRecord(value.metadata);
      const metadata: Record<string, unknown> = {};
      if (typeof metadataInput.field === "string") metadata.field = metadataInput.field.slice(0, 40);
      if (typeof metadataInput.characterCount === "number" && Number.isFinite(metadataInput.characterCount)) {
        metadata.characterCount = Math.max(0, Math.min(100_000, Math.trunc(metadataInput.characterCount)));
      }
      const clientOccurredAt = typeof value.clientOccurredAt === "string"
        ? new Date(value.clientOccurredAt)
        : null;
      if (clientOccurredAt && Number.isNaN(clientOccurredAt.valueOf())) {
        throw new BadRequestException("clientOccurredAt is invalid");
      }
      return this.database.sql.begin(async (tx) => {
        await tx`
          SELECT id
          FROM interview_sessions
          WHERE organization_id = ${scope.organizationId}::uuid
            AND id = ${sessionId}::uuid
          FOR UPDATE
        `;
        const sequenceRows = await tx`
          SELECT COALESCE(max(sequence), -1)::int + 1 AS next_sequence
          FROM interview_integrity_events
          WHERE organization_id = ${scope.organizationId}::uuid
            AND interview_session_id = ${sessionId}::uuid
        `;
        const sequence = Number(sequenceRows[0]?.next_sequence ?? 0);
        const rows = await tx`
          INSERT INTO interview_integrity_events (
            organization_id, interview_session_id, media_session_id, sequence,
            event_type, client_occurred_at, duration_ms, metadata
          ) VALUES (
            ${scope.organizationId}::uuid,
            ${sessionId}::uuid,
            ${mediaSessionId}::uuid,
            ${sequence},
            ${eventType},
            ${clientOccurredAt},
            ${durationMs},
            ${this.database.sql.json(metadata as never)}
          )
          RETURNING id::text, created_at
        `;
        return {
          id: String(rows[0]?.id),
          sequence,
          eventType,
          createdAt: new Date(String(rows[0]?.created_at)).toISOString(),
          interpretation: "observable_signal_only" as const,
        };
      });
    });
  }

  async turnAudio(
    rawToken: string | undefined,
    sessionId: string,
    mediaSessionId: string,
    turnId: string,
  ) {
    const scope = await this.scope(rawToken);
    await this.requireReadyConsent(rawToken);
    return this.tenantContext.run(scope.organizationId, async () => {
      const runtime = await this.assertOwnedRuntime(scope, sessionId, mediaSessionId);
      return runtime.realCandidate
        ? this.speech.synthesizeAuthenticatedCandidateTurn(sessionId, mediaSessionId, turnId)
        : this.speech.synthesizePersistedTurn(sessionId, mediaSessionId, turnId);
    });
  }
}

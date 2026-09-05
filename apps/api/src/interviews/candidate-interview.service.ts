import { createHash } from "node:crypto";
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { CandidateConsentService } from "../auth/candidate-consent.service";
import {
  CandidateSessionService,
  type ResolvedCandidateSession,
} from "../auth/candidate-session.service";
import { getEnv } from "../config/env";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import { InterviewBrainService } from "./interview-brain.service";
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

@Injectable()
export class CandidateInterviewService {
  constructor(
    private readonly database: DatabaseService,
    private readonly candidateSessions: CandidateSessionService,
    private readonly candidateConsent: CandidateConsentService,
    private readonly tenantContext: TenantContextService,
    private readonly interviews: InterviewsService,
    private readonly state: InterviewSessionStateService,
    private readonly brain: InterviewBrainService,
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
          SELECT s.status, s.remaining_seconds, s.checkpoint, m.id::text AS media_session_id
          FROM interview_sessions s
          JOIN applications a
            ON a.organization_id = s.organization_id AND a.id = s.application_id
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
          SELECT s.status, s.remaining_seconds, s.checkpoint
          FROM interview_sessions s
          JOIN applications a
            ON a.organization_id = s.organization_id AND a.id = s.application_id
          WHERE s.organization_id = ${scope.organizationId}::uuid
            AND s.id = ${sessionId}::uuid
            AND s.application_id = ${scope.applicationId}::uuid
            AND a.candidate_id = ${scope.candidateId}::uuid
          LIMIT 1
        `;
    if (!rows[0]) throw new NotFoundException("Candidate interview runtime not found");
    const checkpoint = asRecord(rows[0].checkpoint);
    return {
      status: String(rows[0].status),
      remainingSeconds: Number(rows[0].remaining_seconds ?? 0),
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

  private async currentOrFirstTurn(sessionId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      SELECT id::text, action, criterion_key, spoken_text, finalized
      FROM interview_turns
      WHERE organization_id = ${organizationId}::uuid
        AND interview_session_id = ${sessionId}::uuid
        AND finalized = true
      ORDER BY sequence DESC
      LIMIT 1
    `;
    if (rows[0]) {
      return {
        id: String(rows[0].id),
        action: String(rows[0].action),
        criterion: rows[0].criterion_key ? String(rows[0].criterion_key) : null,
        spokenText: String(rows[0].spoken_text),
      };
    }

    const turn = await this.brain.nextTurn(sessionId, { elapsedSeconds: 0 });
    const durationMs = estimateSpeechDurationMs(turn.spokenText);
    await this.interviews.appendTranscriptSegment(sessionId, {
      speaker: "interviewer",
      startMs: 0,
      endMs: durationMs,
      text: turn.spokenText,
      isFinal: true,
    });
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
          AND status IN ('invited', 'in_progress', 'reconnecting')
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

      const sessionRows = await this.database.sql`
        SELECT status FROM interview_sessions
        WHERE organization_id = ${scope.organizationId}::uuid AND id = ${sessionId}::uuid
        LIMIT 1
      `;
      if (String(sessionRows[0]?.status) === "invited") {
        await this.state.transition(sessionId, {
          idempotencyKey: `candidate-start-${sessionId}`,
          action: "start",
        });
      }

      const latestMediaSession = await this.media.getLatestMediaSession(sessionId);
      const activeMediaSessionId =
        latestMediaSession && !["ended", "failed"].includes(latestMediaSession.status)
          ? latestMediaSession.id
          : (await this.media.createMediaSession(sessionId, "audio")).id;
      const connection = await this.issueCandidateConnection(scope, sessionId, activeMediaSessionId);
      const turn = await this.currentOrFirstTurn(sessionId);
      const runtime = await this.assertOwnedRuntime(scope, sessionId, activeMediaSessionId);
      const messages = await this.transcript(sessionId);

      return {
        status: turn.action === "close" ? "completed" : "active",
        sessionId,
        mediaSessionId: activeMediaSessionId,
        remainingSeconds: runtime.remainingSeconds,
        developmentPreview,
        releaseMode: runtime.releaseMode,
        interviewer: {
          name: "AI Interviewer",
          subtitle: "Structured interview",
          avatarVideoAvailable: false,
        },
        turn: {
          id: turn.id,
          action: turn.action,
          criterion: turn.criterion,
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
    const candidateText = text.trim();
    if (!candidateText) throw new BadRequestException("Candidate answer is empty");

    const startMs = await this.elapsedMs(sessionId);
    const candidateDurationMs = Math.max(250, Math.round(durationSeconds * 1000));
    await this.interviews.appendTranscriptSegment(sessionId, {
      speaker: "candidate",
      startMs,
      endMs: startMs + candidateDurationMs,
      text: candidateText,
      isFinal: true,
    });
    const nextTurn = await this.brain.nextTurn(sessionId, {
      latestCandidateText: candidateText,
      candidateIntent: "ANSWER",
      elapsedSeconds: Math.max(1, Math.round(durationSeconds)),
    });
    const interviewerStartMs = startMs + candidateDurationMs;
    const interviewerDurationMs = estimateSpeechDurationMs(nextTurn.spokenText);
    await this.interviews.appendTranscriptSegment(sessionId, {
      speaker: "interviewer",
      startMs: interviewerStartMs,
      endMs: interviewerStartMs + interviewerDurationMs,
      text: nextTurn.spokenText,
      isFinal: true,
    });
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
    return {
      candidateText,
      remainingSeconds: nextTurn.remainingSeconds,
      completed: nextTurn.action === "close",
      turn: {
        id: nextTurn.id,
        action: nextTurn.action,
        criterion: nextTurn.criterion,
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

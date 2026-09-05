import { randomUUID } from "node:crypto";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import { InterviewMediaService } from "./interview-media.service";
import {
  SPEECH_TO_TEXT_ADAPTER,
  type SpeechToTextAdapter,
  type SpeechToTextContentType,
} from "./speech-to-text.adapter";
import {
  TEXT_TO_SPEECH_ADAPTER,
  type TextToSpeechAdapter,
} from "./text-to-speech.adapter";
import {
  VOICE_ACTIVITY_DETECTION_ADAPTER,
  type VoiceActivityDetectionAdapter,
} from "./voice-activity-detection.adapter";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function providerFailureMetadata(cause: unknown): { code: string; retryable: boolean } {
  if (!cause || typeof cause !== "object") return { code: "provider_error", retryable: false };
  const record = cause as Record<string, unknown>;
  return {
    code: typeof record.code === "string" ? record.code : "provider_error",
    retryable: record.retryable === true,
  };
}

@Injectable()
export class InterviewSpeechService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
    private readonly media: InterviewMediaService,
    @Inject(TEXT_TO_SPEECH_ADAPTER) private readonly tts: TextToSpeechAdapter,
    @Inject(VOICE_ACTIVITY_DETECTION_ADAPTER) private readonly vad: VoiceActivityDetectionAdapter,
    @Inject(SPEECH_TO_TEXT_ADAPTER) private readonly stt: SpeechToTextAdapter,
  ) {}

  private async requireMediaSession(
    sessionId: string,
    mediaSessionId: string,
    expectedRealCandidate: boolean,
  ) {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      SELECT m.mode, m.status AS media_status, s.checkpoint
      FROM interview_media_sessions m
      JOIN interview_sessions s
        ON s.organization_id = m.organization_id AND s.id = m.interview_session_id
      WHERE m.organization_id = ${organizationId}::uuid
        AND m.id = ${mediaSessionId}::uuid
        AND m.interview_session_id = ${sessionId}::uuid
      LIMIT 1
    `;
    if (!rows.length) throw new NotFoundException("Interview media session not found");

    const row = rows[0];
    const checkpoint = asRecord(row?.checkpoint);
    const isRealCandidate = checkpoint.candidateIsRealCustomerCandidate === true;
    if (isRealCandidate !== expectedRealCandidate) {
      throw new BadRequestException(
        expectedRealCandidate
          ? "Candidate speech endpoint requires a real-candidate interview session"
          : "Internal development speech endpoint does not process real-customer candidate sessions",
      );
    }
    const mediaStatus = String(row?.media_status ?? "unknown");
    if (["ended", "failed"].includes(mediaStatus)) {
      throw new BadRequestException(`Interview media session is ${mediaStatus}`);
    }
    const mode = String(row?.mode);
    if (mode !== "audio" && mode !== "avatar") {
      throw new BadRequestException("Unsupported media mode");
    }
    return { mode, mediaStatus };
  }

  private async transcribeAudio(
    sessionId: string,
    mediaSessionId: string,
    audio: Uint8Array,
    contentType: SpeechToTextContentType,
    expectedRealCandidate: boolean,
  ) {
    await this.requireMediaSession(sessionId, mediaSessionId, expectedRealCandidate);
    if (audio.byteLength === 0) throw new BadRequestException("Candidate audio is required");

    const vadReadiness = await this.vad.readiness();
    if (!vadReadiness.ready) {
      throw new BadRequestException(
        `VAD provider is not ready${vadReadiness.reason ? `: ${vadReadiness.reason}` : ""}`,
      );
    }
    const sttReadiness = await this.stt.readiness();
    if (!sttReadiness.ready) {
      throw new BadRequestException(
        `STT provider is not ready${sttReadiness.reason ? `: ${sttReadiness.reason}` : ""}`,
      );
    }

    const vadRequestId = `vad:${randomUUID()}`;
    let vadResult: Awaited<ReturnType<VoiceActivityDetectionAdapter["analyze"]>>;
    try {
      vadResult = await this.vad.analyze({ audio, contentType, requestId: vadRequestId });
    } catch (cause) {
      const failure = providerFailureMetadata(cause);
      await this.media.appendEvent(sessionId, mediaSessionId, {
        idempotencyKey: `vad:${vadRequestId}:error`,
        eventType: "error",
        sourceComponent: "vad",
        payload: {
          message: "VAD provider request failed",
          fatal: false,
          code: failure.code,
          retryable: failure.retryable,
        },
      });
      throw new BadRequestException("VAD provider request failed");
    }

    if (vadResult.speechDetected) {
      await this.media.appendEvent(sessionId, mediaSessionId, {
        idempotencyKey: `vad:${vadRequestId}:speech-start`,
        eventType: "vad_speech_start",
        sourceComponent: "vad",
        payload: {
          requestId: vadResult.requestId,
          firstStartSeconds: vadResult.segments[0]?.startSeconds ?? 0,
          provider: vadResult.provider,
        },
      });
    }
    await this.media.appendEvent(sessionId, mediaSessionId, {
      idempotencyKey: `vad:${vadRequestId}:speech-end`,
      eventType: "vad_speech_end",
      sourceComponent: "vad",
      payload: {
        requestId: vadResult.requestId,
        speechDetected: vadResult.speechDetected,
        segments: vadResult.segments.length,
        durationSeconds: vadResult.durationSeconds,
        provider: vadResult.provider,
      },
    });

    if (!vadResult.speechDetected) {
      return {
        speechDetected: false as const,
        durationSeconds: vadResult.durationSeconds,
        segments: vadResult.segments,
        transcript: null,
      };
    }

    const sttRequestId = `stt:${randomUUID()}`;
    let sttResult: Awaited<ReturnType<SpeechToTextAdapter["transcribe"]>>;
    try {
      sttResult = await this.stt.transcribe({ audio, contentType, requestId: sttRequestId });
    } catch (cause) {
      const failure = providerFailureMetadata(cause);
      await this.media.appendEvent(sessionId, mediaSessionId, {
        idempotencyKey: `stt:${sttRequestId}:error`,
        eventType: "error",
        sourceComponent: "stt",
        payload: {
          message: "STT provider request failed",
          fatal: false,
          code: failure.code,
          retryable: failure.retryable,
        },
      });
      throw new BadRequestException("STT provider request failed");
    }

    const text = sttResult.text.trim();
    await this.media.appendEvent(sessionId, mediaSessionId, {
      idempotencyKey: `stt:${sttRequestId}:final`,
      eventType: "stt_final",
      sourceComponent: "stt",
      payload: {
        requestId: sttResult.requestId,
        provider: sttResult.provider,
        language: sttResult.language,
        characters: text.length,
        attempts: sttResult.attempts,
      },
    });

    return {
      speechDetected: true as const,
      durationSeconds: vadResult.durationSeconds,
      segments: vadResult.segments,
      transcript: {
        text,
        language: sttResult.language,
        provider: sttResult.provider,
        requestId: sttResult.requestId,
      },
    };
  }

  async transcribeCandidateAudio(
    sessionId: string,
    mediaSessionId: string,
    audio: Uint8Array,
    contentType: SpeechToTextContentType,
  ) {
    return this.transcribeAudio(sessionId, mediaSessionId, audio, contentType, false);
  }

  async transcribeAuthenticatedCandidateAudio(
    sessionId: string,
    mediaSessionId: string,
    audio: Uint8Array,
    contentType: SpeechToTextContentType,
  ) {
    return this.transcribeAudio(sessionId, mediaSessionId, audio, contentType, true);
  }

  private async synthesizeTurn(
    sessionId: string,
    mediaSessionId: string,
    turnId: string,
    expectedRealCandidate: boolean,
  ) {
    await this.requireMediaSession(sessionId, mediaSessionId, expectedRealCandidate);
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      SELECT t.action, t.spoken_text, t.finalized
      FROM interview_turns t
      WHERE t.organization_id = ${organizationId}::uuid
        AND t.interview_session_id = ${sessionId}::uuid
        AND t.id = ${turnId}::uuid
      LIMIT 1
    `;
    if (!rows.length) throw new NotFoundException("Persisted interview turn not found");

    const row = rows[0];
    if (row?.finalized !== true) {
      throw new BadRequestException("Only finalized persisted Interview Brain turns may reach TTS");
    }
    const spokenText = String(row?.spoken_text ?? "").trim();
    if (!spokenText) throw new BadRequestException("Persisted Interview Brain turn has no spoken text");

    // TTS readiness is deliberately component-local. The browser never supplies spoken text.
    const readiness = await this.tts.readiness();
    if (!readiness.ready) {
      throw new BadRequestException(
        `TTS provider is not ready${readiness.reason ? `: ${readiness.reason}` : ""}`,
      );
    }

    await this.media.appendEvent(sessionId, mediaSessionId, {
      idempotencyKey: `tts:${turnId}:started`,
      eventType: "tts_started",
      sourceComponent: "tts",
      payload: { turnId, action: String(row?.action ?? "unknown") },
    });

    let synthesis: Awaited<ReturnType<TextToSpeechAdapter["synthesize"]>>;
    try {
      synthesis = await this.tts.synthesize({
        spokenText,
        requestId: `tts:${turnId}`,
      });
    } catch (cause) {
      const failure = providerFailureMetadata(cause);
      await this.media.appendEvent(sessionId, mediaSessionId, {
        idempotencyKey: `tts:${turnId}:provider-error`,
        eventType: "error",
        sourceComponent: "tts",
        payload: {
          message: "TTS provider request failed",
          fatal: false,
          turnId,
          code: failure.code,
          retryable: failure.retryable,
        },
      });
      throw new BadRequestException("TTS provider request failed");
    }

    const audioBuffer = Buffer.from(synthesis.audio);
    await this.media.appendEvent(sessionId, mediaSessionId, {
      idempotencyKey: `tts:${turnId}:ended`,
      eventType: "tts_ended",
      sourceComponent: "tts",
      payload: {
        turnId,
        size: audioBuffer.length,
        provider: synthesis.provider,
        attempts: synthesis.attempts,
        contractVersion: synthesis.contractVersion,
      },
    });

    return { audio: audioBuffer, contentType: synthesis.contentType };
  }

  async synthesizePersistedTurn(sessionId: string, mediaSessionId: string, turnId: string) {
    return this.synthesizeTurn(sessionId, mediaSessionId, turnId, false);
  }

  async synthesizeAuthenticatedCandidateTurn(
    sessionId: string,
    mediaSessionId: string,
    turnId: string,
  ) {
    return this.synthesizeTurn(sessionId, mediaSessionId, turnId, true);
  }
}

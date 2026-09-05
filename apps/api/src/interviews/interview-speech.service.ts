import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import { InterviewMediaService } from "./interview-media.service";
import {
  TEXT_TO_SPEECH_ADAPTER,
  type TextToSpeechAdapter,
} from "./text-to-speech.adapter";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function ttsFailureMetadata(cause: unknown): { code: string; retryable: boolean } {
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
  ) {}

  async synthesizePersistedTurn(sessionId: string, mediaSessionId: string, turnId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      SELECT
        m.mode,
        m.status AS media_status,
        s.checkpoint,
        t.action,
        t.spoken_text,
        t.finalized
      FROM interview_media_sessions m
      JOIN interview_sessions s
        ON s.organization_id = m.organization_id AND s.id = m.interview_session_id
      JOIN interview_turns t
        ON t.organization_id = s.organization_id AND t.interview_session_id = s.id
      WHERE m.organization_id = ${organizationId}::uuid
        AND m.id = ${mediaSessionId}::uuid
        AND m.interview_session_id = ${sessionId}::uuid
        AND t.id = ${turnId}::uuid
      LIMIT 1
    `;
    if (!rows.length) throw new NotFoundException("Persisted interview turn/media session pair not found");

    const row = rows[0];
    const checkpoint = asRecord(row?.checkpoint);
    if (checkpoint.candidateIsRealCustomerCandidate === true) {
      throw new BadRequestException(
        "Development TTS bridge does not synthesize real-customer candidate sessions",
      );
    }
    const mediaStatus = String(row?.media_status ?? "unknown");
    if (["ended", "failed"].includes(mediaStatus)) {
      throw new BadRequestException(`Interview media session is ${mediaStatus}`);
    }
    if (row?.finalized !== true) {
      throw new BadRequestException("Only finalized persisted Interview Brain turns may reach TTS");
    }
    const spokenText = String(row?.spoken_text ?? "").trim();
    if (!spokenText) throw new BadRequestException("Persisted Interview Brain turn has no spoken text");

    const mode = String(row?.mode);
    if (mode !== "audio" && mode !== "avatar") throw new BadRequestException("Unsupported media mode");

    // TTS readiness is deliberately component-local. Do not call media.getReadiness() here:
    // LiveKit, VAD, Whisper/STT, FFmpeg and avatar readiness must not delay or block standalone synthesis.
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
      const failure = ttsFailureMetadata(cause);
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

    const audio = Buffer.from(synthesis.audio);
    await this.media.appendEvent(sessionId, mediaSessionId, {
      idempotencyKey: `tts:${turnId}:ended`,
      eventType: "tts_ended",
      sourceComponent: "tts",
      payload: {
        turnId,
        size: audio.length,
        provider: synthesis.provider,
        attempts: synthesis.attempts,
        contractVersion: synthesis.contractVersion,
      },
    });

    return { audio, contentType: synthesis.contentType };
  }
}

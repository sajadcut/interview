import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { getEnv } from "../config/env";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import { InterviewMediaService } from "./interview-media.service";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

@Injectable()
export class InterviewSpeechService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
    private readonly media: InterviewMediaService,
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
    const readiness = await this.media.getReadiness(mode);
    const tts = readiness.providers.find((provider) => provider.component === "tts");
    if (!tts?.ready) {
      throw new BadRequestException(`TTS provider is not ready${tts?.reason ? `: ${tts.reason}` : ""}`);
    }

    const env = getEnv();
    if (!env.TTS_BASE_URL || !env.MEDIA_WORKER_SHARED_SECRET) {
      throw new BadRequestException("TTS_BASE_URL and MEDIA_WORKER_SHARED_SECRET are required");
    }

    await this.media.appendEvent(sessionId, mediaSessionId, {
      idempotencyKey: `tts:${turnId}:started`,
      eventType: "tts_started",
      sourceComponent: "tts",
      payload: { turnId, action: String(row?.action ?? "unknown") },
    });

    const target = `${env.TTS_BASE_URL.replace(/\/$/, "")}/synthesize`;
    let response: Awaited<ReturnType<typeof fetch>>;
    try {
      response = await fetch(target, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-media-worker-secret": env.MEDIA_WORKER_SHARED_SECRET,
        },
        body: JSON.stringify({ spokenText }),
        signal: AbortSignal.timeout(Math.max(env.MEDIA_PROVIDER_TIMEOUT_MS, 30_000)),
        cache: "no-store",
      });
    } catch (cause) {
      await this.media.appendEvent(sessionId, mediaSessionId, {
        idempotencyKey: `tts:${turnId}:provider-connect-error`,
        eventType: "error",
        sourceComponent: "tts",
        payload: { message: "TTS provider connection failed", fatal: false, turnId },
      });
      throw new BadRequestException(
        cause instanceof Error ? `TTS provider connection failed: ${cause.message}` : "TTS provider connection failed",
      );
    }

    if (!response.ok) {
      await this.media.appendEvent(sessionId, mediaSessionId, {
        idempotencyKey: `tts:${turnId}:provider-http-${response.status}`,
        eventType: "error",
        sourceComponent: "tts",
        payload: { message: `TTS provider returned HTTP ${response.status}`, fatal: false, turnId },
      });
      throw new BadRequestException(`TTS provider returned HTTP ${response.status}`);
    }
    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
    if (contentType !== "audio/wav" && contentType !== "audio/x-wav") {
      throw new BadRequestException(`TTS provider returned unsupported content type: ${contentType ?? "missing"}`);
    }
    const audio = Buffer.from(await response.arrayBuffer());
    if (audio.length === 0 || audio.length > 20 * 1024 * 1024) {
      throw new BadRequestException("TTS provider returned an empty or oversized WAV response");
    }

    await this.media.appendEvent(sessionId, mediaSessionId, {
      idempotencyKey: `tts:${turnId}:ended`,
      eventType: "tts_ended",
      sourceComponent: "tts",
      payload: { turnId, size: audio.length },
    });

    return { audio, contentType: "audio/wav" as const };
  }
}

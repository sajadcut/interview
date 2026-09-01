import { randomUUID } from "node:crypto";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { getEnv } from "../config/env";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import {
  evaluateRealtimeMediaReadiness,
  type RealtimeMediaMode,
} from "./interview-media.contracts";
import type {
  InterviewMediaEventInputDto,
  InterviewMediaEventType,
} from "./interview-media.dto";
import { buildMediaProviderDescriptors, probeMediaProviders } from "./interview-media.providers";
import { createLiveKitJoinToken } from "./livekit-access-token";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const FORBIDDEN_OPERATIONAL_PAYLOAD_KEYS = [
  "audio",
  "video",
  "frame",
  "blob",
  "bytes",
  "base64",
  "token",
  "secret",
  "credential",
  "apikey",
  "api_key",
  "transcript",
  "text",
] as const;

function assertSafeOperationalPayload(payload: Record<string, unknown>): void {
  const visit = (value: unknown, path: string): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const normalized = key.toLowerCase();
      if (FORBIDDEN_OPERATIONAL_PAYLOAD_KEYS.some((forbidden) => normalized.includes(forbidden))) {
        throw new BadRequestException(
          `Operational media payload must not contain raw media, transcript text or credentials (${path}${key})`,
        );
      }
      visit(nested, `${path}${key}.`);
    }
  };
  visit(payload, "payload.");
}

export function mediaStatusForEvent(
  currentStatus: string,
  eventType: InterviewMediaEventType,
  fatal = false,
): string {
  if (["ended", "failed"].includes(currentStatus)) return currentStatus;
  if (fatal) return "failed";
  switch (eventType) {
    case "connecting":
      return "connecting";
    case "connected":
    case "reconnected":
      return "connected";
    case "degraded":
    case "disconnected":
    case "error":
      return "degraded";
    case "ended":
      return "ended";
    default:
      return currentStatus;
  }
}

@Injectable()
export class InterviewMediaService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async getReadiness(mode: RealtimeMediaMode = "audio") {
    const env = getEnv();
    const providers = await probeMediaProviders(
      buildMediaProviderDescriptors(env),
      env.MEDIA_PROVIDER_TIMEOUT_MS,
    );
    return evaluateRealtimeMediaReadiness({
      enabled: env.MEDIA_REALTIME_ENABLED,
      mode,
      providers,
    });
  }

  async preflight(sessionId: string, mode: RealtimeMediaMode) {
    const organizationId = this.tenantContext.require().organizationId;
    const sessionRows = await this.database.sql`
      SELECT
        s.id,
        s.status,
        s.checkpoint,
        r.lifecycle_stage
      FROM interview_sessions s
      JOIN interview_plans p
        ON p.organization_id = s.organization_id AND p.id = s.interview_plan_id
      JOIN interview_release_units r
        ON r.organization_id = p.organization_id AND r.id = p.release_unit_id
      WHERE s.organization_id = ${organizationId}::uuid
        AND s.id = ${sessionId}::uuid
      LIMIT 1
    `;
    if (!sessionRows.length) throw new NotFoundException("Interview session not found");

    const session = sessionRows[0];
    const checkpoint = asRecord(session?.checkpoint);
    const blockers: string[] = [];
    const sessionStatus = String(session?.status ?? "unknown");
    const lifecycleStage = String(session?.lifecycle_stage ?? "unknown");
    const candidateIsRealCustomerCandidate = checkpoint.candidateIsRealCustomerCandidate === true;
    const releaseMode = typeof checkpoint.releaseMode === "string" ? checkpoint.releaseMode : "unknown";

    if (["completed", "cancelled", "failed"].includes(sessionStatus)) {
      blockers.push(`Interview session is ${sessionStatus}.`);
    }
    if (lifecycleStage === "SUSPENDED") {
      blockers.push("Interview release unit is suspended.");
    }
    if (
      candidateIsRealCustomerCandidate &&
      !["supervised", "autonomous"].includes(releaseMode)
    ) {
      blockers.push("Stored release decision does not permit realtime execution for a real customer candidate.");
    }

    const consentRecordId =
      typeof checkpoint.consentRecordId === "string" ? checkpoint.consentRecordId : null;
    const consentRows = consentRecordId
      ? await this.database.sql`
          SELECT recording_allowed, transcript_allowed
          FROM consent_records
          WHERE organization_id = ${organizationId}::uuid
            AND id = ${consentRecordId}::uuid
            AND withdrawn_at IS NULL
          LIMIT 1
        `
      : [];
    const consent = consentRows[0];
    const transcriptAllowed = consent?.transcript_allowed === true;
    const recordingAllowed = consent?.recording_allowed === true;
    if (!consentRecordId || !consentRows.length) blockers.push("Active AI interview consent record is missing.");
    if (!transcriptAllowed) blockers.push("Transcript consent is required for the realtime interview pipeline.");

    const media = await this.getReadiness(mode);
    blockers.push(...media.blockers);

    return {
      ready: blockers.length === 0,
      blockers,
      sessionId,
      sessionStatus,
      mode,
      lifecycleStage,
      releaseMode,
      candidateIsRealCustomerCandidate,
      consent: {
        transcriptAllowed,
        recordingAllowed,
        recordingRequiredForTransport: false,
      },
      media,
    };
  }

  async createMediaSession(sessionId: string, mode: RealtimeMediaMode) {
    const preflight = await this.preflight(sessionId, mode);
    if (!preflight.ready) {
      throw new BadRequestException({
        message: "Realtime media preflight failed",
        blockers: preflight.blockers,
      });
    }

    const organizationId = this.tenantContext.require().organizationId;
    const transport = preflight.media.providers.find((provider) => provider.component === "transport");
    if (!transport) throw new BadRequestException("Realtime transport provider is missing");

    const roomReference = `interview-${sessionId}-${randomUUID()}`;
    const pipelineVersions = Object.fromEntries(
      preflight.media.providers.map((provider) => [
        provider.component,
        {
          provider: provider.provider,
          ...(provider.version ? { version: provider.version } : {}),
        },
      ]),
    );

    return this.database.sql.begin(async (transaction) => {
      const rows = await transaction`
        INSERT INTO interview_media_sessions (
          organization_id,
          interview_session_id,
          mode,
          status,
          transport_provider,
          room_reference,
          pipeline_versions,
          readiness_snapshot,
          recording_state
        ) VALUES (
          ${organizationId}::uuid,
          ${sessionId}::uuid,
          ${mode},
          'preflight',
          ${transport.provider},
          ${roomReference},
          ${this.database.sql.json(pipelineVersions as never)},
          ${this.database.sql.json(preflight as never)},
          ${preflight.consent.recordingAllowed ? "not_requested" : "disabled"}
        )
        RETURNING id, status, created_at
      `;
      const mediaSessionId = String(rows[0]?.id);
      await transaction`
        INSERT INTO interview_media_events (
          organization_id,
          media_session_id,
          sequence,
          event_type,
          source_component,
          payload
        ) VALUES (
          ${organizationId}::uuid,
          ${mediaSessionId}::uuid,
          0,
          'preflight',
          'api',
          ${this.database.sql.json({
            mode,
            ready: true,
            privacy: preflight.media.privacy,
            providerStates: preflight.media.providers.map((provider) => ({
              component: provider.component,
              provider: provider.provider,
              ready: provider.ready,
              ...(provider.version ? { version: provider.version } : {}),
            })),
          } as never)}
        )
      `;

      return {
        id: mediaSessionId,
        interviewSessionId: sessionId,
        mode,
        status: String(rows[0]?.status),
        transportProvider: transport.provider,
        roomReference,
        recordingState: preflight.consent.recordingAllowed ? "not_requested" : "disabled",
        pipelineVersions,
        privacy: preflight.media.privacy,
        createdAt: new Date(String(rows[0]?.created_at)).toISOString(),
        connectionCredentialsIssued: false,
        note: "Use the scoped connection endpoint to issue a short-lived LiveKit token after transport readiness is healthy.",
      };
    });
  }

  async issueConnection(sessionId: string, mediaSessionId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      SELECT
        m.id,
        m.mode,
        m.status,
        m.transport_provider,
        m.room_reference,
        s.checkpoint
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
    if (checkpoint.candidateIsRealCustomerCandidate === true) {
      throw new BadRequestException(
        "Internal engineering connection endpoint does not issue credentials for real customer candidates",
      );
    }
    const status = String(row?.status ?? "unknown");
    if (["ended", "failed"].includes(status)) {
      throw new BadRequestException(`Interview media session is ${status}`);
    }
    if (String(row?.transport_provider) !== "livekit") {
      throw new BadRequestException("LiveKit connection credentials require the livekit transport provider");
    }
    const mode = String(row?.mode);
    if (mode !== "audio" && mode !== "avatar") {
      throw new BadRequestException("Unsupported persisted realtime media mode");
    }
    const roomReference = row?.room_reference ? String(row.room_reference) : "";
    if (!roomReference) throw new BadRequestException("Interview media session has no room reference");

    const readiness = await this.getReadiness(mode);
    if (!readiness.ready) {
      throw new BadRequestException({
        message: "Realtime transport is not ready for credential issuance",
        blockers: readiness.blockers,
      });
    }

    const env = getEnv();
    if (!env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) {
      throw new BadRequestException("LiveKit URL/key/secret are not configured");
    }
    const liveKitUrl = new URL(env.LIVEKIT_URL);
    if (liveKitUrl.protocol !== "ws:" && liveKitUrl.protocol !== "wss:") {
      throw new BadRequestException("LIVEKIT_URL must use ws:// or wss:// for browser transport");
    }

    const participantIdentity = `candidate-${mediaSessionId}`;
    const credential = createLiveKitJoinToken({
      apiKey: env.LIVEKIT_API_KEY,
      apiSecret: env.LIVEKIT_API_SECRET,
      room: roomReference,
      participantIdentity,
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
      connectionCredentialsIssued: true,
      persisted: false,
      candidateScope: "synthetic-internal-only" as const,
    };
  }

  async getLatestMediaSession(sessionId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      SELECT
        id,
        mode,
        status,
        transport_provider,
        room_reference,
        pipeline_versions,
        recording_state,
        last_error,
        last_heartbeat_at,
        connected_at,
        ended_at,
        created_at,
        updated_at
      FROM interview_media_sessions
      WHERE organization_id = ${organizationId}::uuid
        AND interview_session_id = ${sessionId}::uuid
      ORDER BY created_at DESC
      LIMIT 1
    `;
    if (!rows.length) return null;
    const row = rows[0];
    return {
      id: String(row?.id),
      interviewSessionId: sessionId,
      mode: String(row?.mode),
      status: String(row?.status),
      transportProvider: String(row?.transport_provider),
      roomReference: row?.room_reference ? String(row.room_reference) : null,
      pipelineVersions: asRecord(row?.pipeline_versions),
      recordingState: String(row?.recording_state),
      lastError: row?.last_error ? String(row.last_error) : null,
      lastHeartbeatAt: row?.last_heartbeat_at ? new Date(String(row.last_heartbeat_at)).toISOString() : null,
      connectedAt: row?.connected_at ? new Date(String(row.connected_at)).toISOString() : null,
      endedAt: row?.ended_at ? new Date(String(row.ended_at)).toISOString() : null,
      createdAt: new Date(String(row?.created_at)).toISOString(),
      updatedAt: new Date(String(row?.updated_at)).toISOString(),
    };
  }

  async appendEvent(
    sessionId: string,
    mediaSessionId: string,
    input: InterviewMediaEventInputDto,
  ) {
    const organizationId = this.tenantContext.require().organizationId;
    const payload = input.payload ?? {};
    assertSafeOperationalPayload(payload);
    const fatal = input.eventType === "error" && payload.fatal === true;

    return this.database.sql.begin(async (transaction) => {
      const mediaRows = await transaction`
        SELECT id, status
        FROM interview_media_sessions
        WHERE organization_id = ${organizationId}::uuid
          AND id = ${mediaSessionId}::uuid
          AND interview_session_id = ${sessionId}::uuid
        FOR UPDATE
      `;
      if (!mediaRows.length) throw new NotFoundException("Interview media session not found");

      const currentStatus = String(mediaRows[0]?.status);
      const nextStatus = mediaStatusForEvent(currentStatus, input.eventType, fatal);
      const sequenceRows = await transaction`
        SELECT COALESCE(max(sequence), -1)::int + 1 AS next_sequence
        FROM interview_media_events
        WHERE organization_id = ${organizationId}::uuid
          AND media_session_id = ${mediaSessionId}::uuid
      `;
      const sequence = Number(sequenceRows[0]?.next_sequence ?? 0);
      const eventRows = await transaction`
        INSERT INTO interview_media_events (
          organization_id,
          media_session_id,
          sequence,
          event_type,
          source_component,
          payload
        ) VALUES (
          ${organizationId}::uuid,
          ${mediaSessionId}::uuid,
          ${sequence},
          ${input.eventType},
          ${input.sourceComponent ?? null},
          ${this.database.sql.json(payload as never)}
        )
        RETURNING id, occurred_at
      `;

      const lastError =
        input.eventType === "error" && typeof payload.message === "string"
          ? payload.message.slice(0, 2000)
          : null;
      await transaction`
        UPDATE interview_media_sessions
        SET
          status = ${nextStatus},
          last_error = CASE WHEN ${lastError}::text IS NULL THEN last_error ELSE ${lastError}::text END,
          last_heartbeat_at = CASE WHEN ${input.eventType === "heartbeat"} THEN now() ELSE last_heartbeat_at END,
          connected_at = CASE
            WHEN ${input.eventType === "connected" || input.eventType === "reconnected"}
              THEN COALESCE(connected_at, now())
            ELSE connected_at
          END,
          ended_at = CASE WHEN ${input.eventType === "ended"} THEN COALESCE(ended_at, now()) ELSE ended_at END,
          updated_at = now()
        WHERE organization_id = ${organizationId}::uuid
          AND id = ${mediaSessionId}::uuid
      `;

      return {
        id: String(eventRows[0]?.id),
        mediaSessionId,
        sequence,
        eventType: input.eventType,
        sourceComponent: input.sourceComponent ?? null,
        status: nextStatus,
        occurredAt: new Date(String(eventRows[0]?.occurred_at)).toISOString(),
      };
    });
  }
}

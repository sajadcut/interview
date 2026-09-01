import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import type { InterviewMediaEventInputDto, InterviewMediaEventType } from "./interview-media.dto";

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
const PARTICIPANT_TYPES = new Set(["candidate", "agent", "supervisor", "worker"]);

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

function nextMediaStatus(currentStatus: string, eventType: InterviewMediaEventType, fatal: boolean): string {
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
    case "turn_failure":
    case "error":
      return "degraded";
    case "ended":
      return "ended";
    default:
      return currentStatus;
  }
}

function participantContext(payload: Record<string, unknown>) {
  const participantKey = typeof payload.participantKey === "string" ? payload.participantKey.trim() : "";
  const participantType = typeof payload.participantType === "string" ? payload.participantType.trim() : "";
  if (!participantKey || participantKey.length > 200) {
    throw new BadRequestException("participantKey is required for participant lifecycle events");
  }
  if (!PARTICIPANT_TYPES.has(participantType)) {
    throw new BadRequestException("participantType must be candidate, agent, supervisor or worker");
  }
  return { participantKey, participantType };
}

@Injectable()
export class InterviewMediaEventService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async appendEvent(
    sessionId: string,
    mediaSessionId: string,
    input: InterviewMediaEventInputDto,
  ) {
    const organizationId = this.tenantContext.require().organizationId;
    const payload = input.payload ?? {};
    assertSafeOperationalPayload(payload);
    const idempotencyKey = input.idempotencyKey.trim();
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
      if (!mediaRows[0]) throw new NotFoundException("Interview media session not found");

      const replayRows = await transaction`
        SELECT e.id::text, e.sequence, e.event_type, e.source_component, e.occurred_at, m.status
        FROM interview_media_events e
        JOIN interview_media_sessions m
          ON m.organization_id = e.organization_id AND m.id = e.media_session_id
        WHERE e.organization_id = ${organizationId}::uuid
          AND e.media_session_id = ${mediaSessionId}::uuid
          AND e.idempotency_key = ${idempotencyKey}
        LIMIT 1
      `;
      if (replayRows[0]) {
        const replay = replayRows[0];
        return {
          id: String(replay.id),
          mediaSessionId,
          sequence: Number(replay.sequence),
          eventType: String(replay.event_type),
          sourceComponent: replay.source_component ? String(replay.source_component) : null,
          status: String(replay.status),
          occurredAt: new Date(String(replay.occurred_at)).toISOString(),
          idempotentReplay: true,
        };
      }

      const currentStatus = String(mediaRows[0].status);
      const nextStatus = nextMediaStatus(currentStatus, input.eventType, fatal);
      const sequenceRows = await transaction`
        SELECT COALESCE(max(sequence), -1)::int + 1 AS next_sequence
        FROM interview_media_events
        WHERE organization_id = ${organizationId}::uuid
          AND media_session_id = ${mediaSessionId}::uuid
      `;
      const sequence = Number(sequenceRows[0]?.next_sequence ?? 0);
      const eventRows = await transaction`
        INSERT INTO interview_media_events (
          organization_id, media_session_id, sequence, event_type,
          source_component, payload, idempotency_key
        ) VALUES (
          ${organizationId}::uuid,
          ${mediaSessionId}::uuid,
          ${sequence},
          ${input.eventType},
          ${input.sourceComponent ?? null},
          ${this.database.sql.json(payload as never)},
          ${idempotencyKey}
        )
        RETURNING id::text, occurred_at
      `;

      if (input.eventType === "participant_joined") {
        const participant = participantContext(payload);
        await transaction`
          INSERT INTO interview_media_participants (
            organization_id, media_session_id, participant_key, participant_type,
            state, joined_at, left_at, last_event_sequence, metadata
          ) VALUES (
            ${organizationId}::uuid,
            ${mediaSessionId}::uuid,
            ${participant.participantKey},
            ${participant.participantType},
            'joined',
            now(),
            NULL,
            ${sequence},
            ${this.database.sql.json({ sourceComponent: input.sourceComponent ?? null } as never)}
          )
          ON CONFLICT (organization_id, media_session_id, participant_key)
          DO UPDATE SET
            participant_type = EXCLUDED.participant_type,
            state = 'joined',
            joined_at = now(),
            left_at = NULL,
            last_event_sequence = EXCLUDED.last_event_sequence,
            updated_at = now()
        `;
      } else if (input.eventType === "participant_left") {
        const participant = participantContext(payload);
        await transaction`
          UPDATE interview_media_participants
          SET state = 'left', left_at = now(), last_event_sequence = ${sequence}, updated_at = now()
          WHERE organization_id = ${organizationId}::uuid
            AND media_session_id = ${mediaSessionId}::uuid
            AND participant_key = ${participant.participantKey}
            AND participant_type = ${participant.participantType}
        `;
      }

      const lastError =
        input.eventType === "turn_failure"
          ? `TURN failure${typeof payload.failureCode === "string" ? `: ${payload.failureCode.slice(0, 120)}` : ""}`
          : input.eventType === "error" && typeof payload.message === "string"
            ? payload.message.slice(0, 2000)
            : null;
      await transaction`
        UPDATE interview_media_sessions
        SET status = ${nextStatus},
            last_error = CASE WHEN ${lastError}::text IS NULL THEN last_error ELSE ${lastError}::text END,
            last_heartbeat_at = CASE WHEN ${input.eventType === "heartbeat"} THEN now() ELSE last_heartbeat_at END,
            connected_at = CASE
              WHEN ${input.eventType === "connected" || input.eventType === "reconnected"}
                THEN COALESCE(connected_at, now())
              ELSE connected_at
            END,
            ended_at = CASE WHEN ${input.eventType === "ended"} THEN COALESCE(ended_at, now()) ELSE ended_at END,
            updated_at = now()
        WHERE organization_id = ${organizationId}::uuid AND id = ${mediaSessionId}::uuid
      `;

      return {
        id: String(eventRows[0]?.id),
        mediaSessionId,
        sequence,
        eventType: input.eventType,
        sourceComponent: input.sourceComponent ?? null,
        status: nextStatus,
        occurredAt: new Date(String(eventRows[0]?.occurred_at)).toISOString(),
        idempotentReplay: false,
      };
    });
  }

  async listParticipants(sessionId: string, mediaSessionId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      SELECT p.participant_key, p.participant_type, p.state, p.joined_at, p.left_at,
             p.last_event_sequence, p.updated_at
      FROM interview_media_participants p
      JOIN interview_media_sessions m
        ON m.organization_id = p.organization_id AND m.id = p.media_session_id
      WHERE p.organization_id = ${organizationId}::uuid
        AND p.media_session_id = ${mediaSessionId}::uuid
        AND m.interview_session_id = ${sessionId}::uuid
      ORDER BY p.joined_at, p.participant_key
    `;
    return rows.map((row) => ({
      participantKey: String(row.participant_key),
      participantType: String(row.participant_type),
      state: String(row.state),
      joinedAt: new Date(String(row.joined_at)).toISOString(),
      ...(row.left_at ? { leftAt: new Date(String(row.left_at)).toISOString() } : {}),
      ...(row.last_event_sequence !== null
        ? { lastEventSequence: Number(row.last_event_sequence) }
        : {}),
      updatedAt: new Date(String(row.updated_at)).toISOString(),
    }));
  }
}

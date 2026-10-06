import { createHash } from "node:crypto";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import { AuthContextService } from "../auth/auth-context.service";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import {
  analyzeInterviewIntegrity,
  classifyIntegrityEvent,
  type IntegrityEvent,
  type IntegrityEventType,
} from "./interview-integrity";

const CANDIDATE_EVENT_TYPES = new Set<IntegrityEventType>([
  "visibility_hidden",
  "visibility_visible",
  "window_blur",
  "window_focus",
  "large_paste",
  "reconnect",
  "network_disconnect",
  "network_reconnect",
  "media_device_changed",
  "microphone_disabled",
  "microphone_enabled",
  "camera_disabled",
  "camera_enabled",
  "unexpected_room_participant",
  "answer_submission_spike",
]);

const SERVER_EVENT_TYPES = new Set<IntegrityEventType>([
  "concurrent_session_detected",
  "candidate_session_replaced",
  "repeated_large_paste",
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function boundedNumber(value: unknown, minimum: number, maximum: number): number | undefined {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(minimum, Math.min(maximum, Math.trunc(number)))
    : undefined;
}

function boundedText(value: unknown, maximum: number): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maximum)
    : undefined;
}

function sanitizeMetadata(value: unknown): Record<string, unknown> {
  const input = asRecord(value);
  const output: Record<string, unknown> = {};
  const field = boundedText(input.field, 40);
  const phase = boundedText(input.phase, 40);
  const currentTurnId = boundedText(input.currentTurnId, 80);
  const reason = boundedText(input.reason, 80);
  const deviceKind = boundedText(input.deviceKind, 40);
  if (field) output.field = field;
  if (phase) output.phase = phase;
  if (currentTurnId) output.currentTurnId = currentTurnId;
  if (reason) output.reason = reason;
  if (deviceKind) output.deviceKind = deviceKind;

  const characterCount = boundedNumber(input.characterCount, 0, 100_000);
  const answerLength = boundedNumber(input.answerLength, 0, 100_000);
  const remainingSeconds = boundedNumber(input.remainingSeconds, 0, 86_400);
  const participantCount = boundedNumber(input.participantCount, 0, 32);
  const reconnectCount = boundedNumber(input.reconnectCount, 0, 1_000);
  if (characterCount !== undefined) output.characterCount = characterCount;
  if (answerLength !== undefined) output.answerLength = answerLength;
  if (remainingSeconds !== undefined) output.remainingSeconds = remainingSeconds;
  if (participantCount !== undefined) output.participantCount = participantCount;
  if (reconnectCount !== undefined) output.reconnectCount = reconnectCount;
  if (input.duringAnswer === true) output.duringAnswer = true;
  if (input.replacedExistingSession === true) output.replacedExistingSession = true;
  return output;
}

function userAgentFamily(raw: string | undefined): string | null {
  const value = raw ?? "";
  if (/Edg\//i.test(value)) return "Edge";
  if (/Firefox\//i.test(value)) return "Firefox";
  if (/Chrome\//i.test(value) && !/Edg\//i.test(value)) return "Chrome";
  if (/Safari\//i.test(value) && !/Chrome\//i.test(value)) return "Safari";
  if (/Mobile/i.test(value)) return "Mobile browser";
  return value ? "Other browser" : null;
}

function eventSource(eventType: IntegrityEventType): "candidate_browser" | "livekit_client" {
  return eventType === "unexpected_room_participant" ? "livekit_client" : "candidate_browser";
}

@Injectable()
export class InterviewIntegrityService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
    private readonly authContext: AuthContextService,
    private readonly audit: AuditService,
  ) {}

  private organizationId(): string {
    return this.tenantContext.require().organizationId;
  }

  private async assertSession(sessionId: string): Promise<Record<string, unknown>> {
    const organizationId = this.organizationId();
    const rows = await this.database.sql`
      SELECT id::text, status, started_at, completed_at
      FROM interview_sessions
      WHERE organization_id = ${organizationId}::uuid
        AND id = ${sessionId}::uuid
      LIMIT 1
    `;
    if (!rows[0]) throw new NotFoundException("Interview session not found");
    return rows[0];
  }

  async recordCandidateEvent(
    sessionId: string,
    mediaSessionId: string,
    body: unknown,
  ) {
    await this.assertSession(sessionId);
    const organizationId = this.organizationId();
    const value = asRecord(body);
    const eventType = String(value.eventType ?? "") as IntegrityEventType;
    if (!CANDIDATE_EVENT_TYPES.has(eventType)) {
      throw new BadRequestException("Unsupported candidate integrity event");
    }

    const durationMs = value.durationMs === undefined
      ? null
      : boundedNumber(value.durationMs, 0, 86_400_000);
    if (value.durationMs !== undefined && durationMs === undefined) {
      throw new BadRequestException("durationMs is invalid");
    }
    const metadata = sanitizeMetadata(value.metadata);
    const clientOccurredAt = typeof value.clientOccurredAt === "string"
      ? new Date(value.clientOccurredAt)
      : null;
    if (clientOccurredAt && Number.isNaN(clientOccurredAt.valueOf())) {
      throw new BadRequestException("clientOccurredAt is invalid");
    }
    const classification = classifyIntegrityEvent({ eventType, durationMs, metadata });
    const source = eventSource(eventType);

    const recorded = await this.database.sql.begin(async (tx) => {
      const mediaRows = await tx`
        SELECT id
        FROM interview_media_sessions
        WHERE organization_id = ${organizationId}::uuid
          AND interview_session_id = ${sessionId}::uuid
          AND id = ${mediaSessionId}::uuid
        LIMIT 1
      `;
      if (!mediaRows[0]) throw new NotFoundException("Interview media session not found");

      const sequenceRows = await tx`
        SELECT COALESCE(max(sequence), -1)::int + 1 AS next_sequence
        FROM interview_integrity_events
        WHERE organization_id = ${organizationId}::uuid
          AND interview_session_id = ${sessionId}::uuid
      `;
      const sequence = Number(sequenceRows[0]?.next_sequence ?? 0);
      const rows = await tx`
        INSERT INTO interview_integrity_events (
          organization_id, interview_session_id, media_session_id, sequence,
          event_type, client_occurred_at, duration_ms, metadata,
          server_occurred_at, source, severity, interpretation
        ) VALUES (
          ${organizationId}::uuid,
          ${sessionId}::uuid,
          ${mediaSessionId}::uuid,
          ${sequence},
          ${eventType},
          ${clientOccurredAt},
          ${durationMs},
          ${this.database.sql.json(metadata as never)},
          now(),
          ${source},
          ${classification.severity},
          ${classification.interpretation}
        )
        RETURNING id::text, server_occurred_at
      `;
      return {
        id: String(rows[0]?.id),
        sequence,
        eventType,
        serverOccurredAt: new Date(String(rows[0]?.server_occurred_at)).toISOString(),
        interpretation: "observable_signal_recorded" as const,
      };
    });
  }

    if (
      eventType === "large_paste" &&
      Number(metadata.characterCount ?? 0) >= 300
    ) {
      const counts = await this.database.sql`
        SELECT
          count(*) FILTER (WHERE event_type='large_paste' AND COALESCE((metadata->>'characterCount')::int, 0) >= 300)::int AS large_paste_count,
          count(*) FILTER (WHERE event_type='repeated_large_paste')::int AS repeated_marker_count
        FROM interview_integrity_events
        WHERE organization_id=${organizationId}::uuid
          AND interview_session_id=${sessionId}::uuid
      `;
      if (
        Number(counts[0]?.large_paste_count ?? 0) >= 2 &&
        Number(counts[0]?.repeated_marker_count ?? 0) === 0
      ) {
        await this.recordServerEvent({
          sessionId,
          mediaSessionId,
          eventType: "repeated_large_paste",
          metadata: { reason: "multiple_large_paste_events" },
        });
      }
    }
    return recorded;

  async recordServerEvent(input: {
    sessionId: string;
    mediaSessionId?: string | null;
    eventType: IntegrityEventType;
    metadata?: Record<string, unknown>;
    durationMs?: number | null;
  }): Promise<{ id: string; sequence: number }> {
    if (!SERVER_EVENT_TYPES.has(input.eventType)) {
      throw new BadRequestException("Unsupported server integrity event");
    }
    await this.assertSession(input.sessionId);
    const organizationId = this.organizationId();
    const metadata = sanitizeMetadata(input.metadata);
    const classification = classifyIntegrityEvent({
      eventType: input.eventType,
      durationMs: input.durationMs,
      metadata,
    });

    return this.database.sql.begin(async (tx) => {
      const sequenceRows = await tx`
        SELECT COALESCE(max(sequence), -1)::int + 1 AS next_sequence
        FROM interview_integrity_events
        WHERE organization_id = ${organizationId}::uuid
          AND interview_session_id = ${input.sessionId}::uuid
      `;
      const sequence = Number(sequenceRows[0]?.next_sequence ?? 0);
      const rows = await tx`
        INSERT INTO interview_integrity_events (
          organization_id, interview_session_id, media_session_id, sequence,
          event_type, duration_ms, metadata, server_occurred_at,
          source, severity, interpretation
        ) VALUES (
          ${organizationId}::uuid,
          ${input.sessionId}::uuid,
          ${input.mediaSessionId ?? null}::uuid,
          ${sequence},
          ${input.eventType},
          ${input.durationMs ?? null},
          ${this.database.sql.json(metadata as never)},
          now(),
          'server',
          ${classification.severity},
          ${classification.interpretation}
        )
        RETURNING id::text
      `;
      return { id: String(rows[0]?.id), sequence };
    });
  }

  async registerCandidateConnection(input: {
    sessionId: string;
    mediaSessionId: string;
    clientInstanceId?: string;
    userAgent?: string;
  }): Promise<{ concurrentSessionDetected: boolean; clientInstanceHash: string | null }> {
    if (!input.clientInstanceId?.trim()) {
      return { concurrentSessionDetected: false, clientInstanceHash: null };
    }
    if (input.clientInstanceId.length > 200) {
      throw new BadRequestException("clientInstanceId is invalid");
    }
    await this.assertSession(input.sessionId);
    const organizationId = this.organizationId();
    const clientInstanceHash = createHash("sha256")
      .update(`${organizationId}:${input.clientInstanceId.trim()}`)
      .digest("hex");
    const family = userAgentFamily(input.userAgent);

    const result = await this.database.sql.begin(async (tx) => {
      await tx`
        SELECT id
        FROM interview_sessions
        WHERE organization_id = ${organizationId}::uuid
          AND id = ${input.sessionId}::uuid
        FOR UPDATE
      `;
      const active = await tx`
        SELECT id::text, client_instance_hash
        FROM interview_candidate_connections
        WHERE organization_id = ${organizationId}::uuid
          AND interview_session_id = ${input.sessionId}::uuid
          AND status = 'active'
          AND last_seen_at >= now() - interval '10 minutes'
        ORDER BY last_seen_at DESC
      `;
      const conflicting = active.filter(
        (row) => String(row.client_instance_hash) !== clientInstanceHash,
      );

      if (conflicting.length > 0) {
        await tx`
          UPDATE interview_candidate_connections
          SET status='replaced',
              replaced_by_client_hash=${clientInstanceHash},
              replaced_at=now(),
              last_seen_at=now()
          WHERE organization_id=${organizationId}::uuid
            AND interview_session_id=${input.sessionId}::uuid
            AND status='active'
            AND client_instance_hash<>${clientInstanceHash}
        `;
      }

      await tx`
        INSERT INTO interview_candidate_connections (
          organization_id, interview_session_id, media_session_id,
          client_instance_hash, user_agent_family, status,
          first_seen_at, last_seen_at
        ) VALUES (
          ${organizationId}::uuid,
          ${input.sessionId}::uuid,
          ${input.mediaSessionId}::uuid,
          ${clientInstanceHash},
          ${family},
          'active',
          now(),
          now()
        )
        ON CONFLICT (organization_id, interview_session_id, client_instance_hash)
        DO UPDATE SET
          media_session_id=EXCLUDED.media_session_id,
          user_agent_family=EXCLUDED.user_agent_family,
          status='active',
          last_seen_at=now(),
          replaced_by_client_hash=NULL,
          replaced_at=NULL
      `;
      return { conflictingCount: conflicting.length };
    });

    if (result.conflictingCount > 0) {
      await this.recordServerEvent({
        sessionId: input.sessionId,
        mediaSessionId: input.mediaSessionId,
        eventType: "concurrent_session_detected",
        metadata: { replacedExistingSession: true },
      });
      await this.recordServerEvent({
        sessionId: input.sessionId,
        mediaSessionId: input.mediaSessionId,
        eventType: "candidate_session_replaced",
        metadata: { replacedExistingSession: true, reason: "new_browser_session" },
      });
    }
    return {
      concurrentSessionDetected: result.conflictingCount > 0,
      clientInstanceHash,
    };
  }

  async analyzeAndPersist(sessionId: string) {
    const session = await this.assertSession(sessionId);
    if (String(session.status) !== "completed") {
      throw new BadRequestException("Integrity analysis runs only after interview Finish");
    }
    const organizationId = this.organizationId();
    const rows = await this.database.sql`
      SELECT id::text, sequence, event_type, server_occurred_at, client_occurred_at,
             duration_ms, metadata, source, severity, interpretation
      FROM interview_integrity_events
      WHERE organization_id=${organizationId}::uuid
        AND interview_session_id=${sessionId}::uuid
      ORDER BY sequence
    `;
    const events: IntegrityEvent[] = rows.map((row) => ({
      id: String(row.id),
      sequence: Number(row.sequence),
      eventType: String(row.event_type) as IntegrityEventType,
      serverOccurredAt: new Date(String(row.server_occurred_at)).toISOString(),
      clientOccurredAt: row.client_occurred_at ? new Date(String(row.client_occurred_at)).toISOString() : null,
      durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
      metadata: asRecord(row.metadata),
      source: String(row.source) as IntegrityEvent["source"],
      severity: String(row.severity) as IntegrityEvent["severity"],
      interpretation: String(row.interpretation),
    }));
    const assessment = analyzeInterviewIntegrity(events);
    const persisted = await this.database.sql`
      INSERT INTO interview_integrity_assessments (
        organization_id, interview_session_id, integrity_concern_score,
        risk_level, confidence, requires_human_review, signals,
        summary, analyzer_version, analyzed_at, updated_at
      ) VALUES (
        ${organizationId}::uuid,
        ${sessionId}::uuid,
        ${assessment.integrityConcernScore},
        ${assessment.riskLevel},
        ${assessment.confidence},
        ${assessment.requiresHumanReview},
        ${this.database.sql.json(assessment.signals as never)},
        ${assessment.summary},
        ${assessment.analyzerVersion},
        now(),
        now()
      )
      ON CONFLICT (organization_id, interview_session_id)
      DO UPDATE SET
        integrity_concern_score=EXCLUDED.integrity_concern_score,
        risk_level=EXCLUDED.risk_level,
        confidence=EXCLUDED.confidence,
        requires_human_review=EXCLUDED.requires_human_review,
        signals=EXCLUDED.signals,
        summary=EXCLUDED.summary,
        analyzer_version=EXCLUDED.analyzer_version,
        analyzed_at=now(),
        updated_at=now()
      RETURNING id::text, analyzed_at
    `;

    let reviewCaseId: string | null = null;
    if (assessment.requiresHumanReview) {
      const cases = await this.database.sql`
        INSERT INTO interview_integrity_review_cases (
          organization_id, interview_session_id, integrity_assessment_id, status
        ) VALUES (
          ${organizationId}::uuid,
          ${sessionId}::uuid,
          ${String(persisted[0]?.id)}::uuid,
          'pending_review'
        )
        ON CONFLICT (organization_id, interview_session_id)
        DO UPDATE SET integrity_assessment_id=EXCLUDED.integrity_assessment_id, updated_at=now()
        RETURNING id::text, status
      `;
      reviewCaseId = String(cases[0]?.id);
      const eventExists = await this.database.sql`
        SELECT id
        FROM interview_integrity_review_events
        WHERE organization_id=${organizationId}::uuid
          AND review_case_id=${reviewCaseId}::uuid
        LIMIT 1
      `;
      if (!eventExists[0]) {
        await this.database.sql`
          INSERT INTO interview_integrity_review_events (
            organization_id, review_case_id, previous_status, new_status, note, snapshot
          ) VALUES (
            ${organizationId}::uuid,
            ${reviewCaseId}::uuid,
            NULL,
            'pending_review',
            'Automatically created from deterministic integrity analysis',
            ${this.database.sql.json({
              riskLevel: assessment.riskLevel,
              integrityConcernScore: assessment.integrityConcernScore,
            } as never)}
          )
        `;
      }
    }

    return {
      interviewSessionId: sessionId,
      ...assessment,
      analyzedAt: new Date(String(persisted[0]?.analyzed_at)).toISOString(),
      reviewCaseId,
    };
  }

  async getAssessment(sessionId: string) {
    await this.assertSession(sessionId);
    const organizationId = this.organizationId();
    const rows = await this.database.sql`
      SELECT a.id::text, a.integrity_concern_score, a.risk_level, a.confidence,
             a.requires_human_review, a.signals, a.summary, a.analyzer_version, a.analyzed_at,
             c.id::text AS review_case_id, c.status AS review_status,
             c.review_comment, c.reviewed_at, c.reviewer_user_id::text
      FROM interview_integrity_assessments a
      LEFT JOIN interview_integrity_review_cases c
        ON c.organization_id=a.organization_id
       AND c.interview_session_id=a.interview_session_id
      WHERE a.organization_id=${organizationId}::uuid
        AND a.interview_session_id=${sessionId}::uuid
      LIMIT 1
    `;
    if (!rows[0]) {
      return {
        interviewSessionId: sessionId,
        status: "not_analyzed" as const,
        automaticCheatingDecision: false,
        automaticScorePenalty: false,
      };
    }
    const row = rows[0];
    return {
      interviewSessionId: sessionId,
      status: "analyzed" as const,
      integrityConcernScore: Number(row.integrity_concern_score),
      riskLevel: String(row.risk_level),
      confidence: String(row.confidence),
      requiresHumanReview: Boolean(row.requires_human_review),
      signals: Array.isArray(row.signals) ? row.signals : [],
      summary: String(row.summary),
      analyzerVersion: String(row.analyzer_version),
      analyzedAt: new Date(String(row.analyzed_at)).toISOString(),
      automaticCheatingDecision: false,
      automaticScorePenalty: false,
      reviewCase: row.review_case_id
        ? {
            id: String(row.review_case_id),
            status: String(row.review_status),
            ...(row.review_comment ? { comment: String(row.review_comment) } : {}),
            ...(row.reviewed_at ? { reviewedAt: new Date(String(row.reviewed_at)).toISOString() } : {}),
            ...(row.reviewer_user_id ? { reviewerUserId: String(row.reviewer_user_id) } : {}),
          }
        : null,
    };
  }

  async listEvents(sessionId: string) {
    await this.assertSession(sessionId);
    const organizationId = this.organizationId();
    const rows = await this.database.sql`
      SELECT id::text, sequence, event_type, server_occurred_at, client_occurred_at,
             duration_ms, metadata, source, severity, interpretation
      FROM interview_integrity_events
      WHERE organization_id=${organizationId}::uuid
        AND interview_session_id=${sessionId}::uuid
      ORDER BY sequence
    `;
    return rows.map((row) => ({
      id: String(row.id),
      sequence: Number(row.sequence),
      eventType: String(row.event_type),
      serverOccurredAt: new Date(String(row.server_occurred_at)).toISOString(),
      ...(row.client_occurred_at ? { clientOccurredAt: new Date(String(row.client_occurred_at)).toISOString() } : {}),
      ...(row.duration_ms !== null ? { durationMs: Number(row.duration_ms) } : {}),
      metadata: asRecord(row.metadata),
      source: String(row.source),
      severity: String(row.severity),
      interpretation: String(row.interpretation),
    }));
  }

  async review(sessionId: string, body: unknown) {
    await this.assertSession(sessionId);
    const organizationId = this.organizationId();
    const actorUserId = this.authContext.getOptional()?.userId;
    if (!actorUserId) throw new BadRequestException("Authenticated human reviewer is required");
    const value = asRecord(body);
    const status = String(value.status ?? "");
    if (!["reviewed_no_concern", "reviewed_concern", "inconclusive"].includes(status)) {
      throw new BadRequestException("Unsupported integrity review status");
    }
    const comment = boundedText(value.comment, 4_000);
    if (!comment) throw new BadRequestException("Integrity review comment is required");

    const result = await this.database.sql.begin(async (tx) => {
      const rows = await tx`
        SELECT id::text, status
        FROM interview_integrity_review_cases
        WHERE organization_id=${organizationId}::uuid
          AND interview_session_id=${sessionId}::uuid
        FOR UPDATE
      `;
      const current = rows[0];
      if (!current) throw new NotFoundException("Integrity review case not found");
      if (String(current.status) !== "pending_review") {
        throw new BadRequestException("Integrity review case is already resolved");
      }
      const previousStatus = String(current.status);
      const updated = await tx`
        UPDATE interview_integrity_review_cases
        SET status=${status},
            reviewer_user_id=${actorUserId}::uuid,
            review_comment=${comment},
            reviewed_at=now(),
            updated_at=now()
        WHERE organization_id=${organizationId}::uuid
          AND id=${String(current.id)}::uuid
        RETURNING id::text, status, reviewed_at
      `;
      await tx`
        INSERT INTO interview_integrity_review_events (
          organization_id, review_case_id, actor_user_id,
          previous_status, new_status, note, snapshot
        ) VALUES (
          ${organizationId}::uuid,
          ${String(current.id)}::uuid,
          ${actorUserId}::uuid,
          ${previousStatus},
          ${status},
          ${comment},
          ${this.database.sql.json({ reviewerUserId: actorUserId } as never)}
        )
      `;
      return {
        id: String(updated[0]?.id),
        previousStatus,
        status: String(updated[0]?.status),
        reviewedAt: new Date(String(updated[0]?.reviewed_at)).toISOString(),
      };
    });

    await this.audit.record({
      action: "interview.integrity.review",
      entityType: "interview_integrity_review_case",
      entityId: result.id,
      reason: comment,
      before: { status: result.previousStatus },
      after: { status: result.status },
      metadata: { interviewSessionId: sessionId, note: comment },
    });

    return {
      id: result.id,
      interviewSessionId: sessionId,
      status: result.status,
      comment,
      reviewedAt: result.reviewedAt,
    };
  }
}

import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import type { InterviewSessionTransitionInputDto } from "./interview-session-state.dto";
import {
  INTERVIEW_SESSION_STATE_CONTRACT_VERSION,
  InterviewSessionStatuses,
  InterviewSessionTransitionError,
  allowedInterviewSessionActions,
  transitionInterviewSession,
  type InterviewSessionMachineState,
  type InterviewSessionResumeStatus,
  type InterviewSessionStatus,
} from "./interview-session-state-machine";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function boundedPolicyLimit(value: unknown, fallback = 3): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(20, Math.max(1, Math.trunc(value)));
}

function parseStatus(value: unknown): InterviewSessionStatus {
  const status = String(value ?? "");
  if (!InterviewSessionStatuses.includes(status as InterviewSessionStatus)) {
    throw new ConflictException(`Interview session has unsupported lifecycle status: ${status || "unknown"}`);
  }
  return status as InterviewSessionStatus;
}

function parseResumeStatus(value: unknown): InterviewSessionResumeStatus | null {
  return value === "in_progress" || value === "paused" ? value : null;
}

function normalizeOptionalText(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized ? normalized : null;
}

function requestFingerprint(input: {
  action: string;
  expectedVersion: number | null;
  reason: string | null;
  failureCode: string | null;
  recoverable: boolean | null;
}): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

@Injectable()
export class InterviewSessionStateService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async getState(sessionId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      SELECT
        s.id::text,
        s.status,
        s.state_version,
        s.reconnect_count,
        s.recovery_attempt_count,
        s.resume_status,
        s.failure_code,
        s.failure_recoverable,
        s.started_at,
        s.completed_at,
        s.paused_at,
        s.disconnected_at,
        s.last_failure_at,
        s.last_transition_at,
        p.recovery_policy
      FROM interview_sessions s
      JOIN interview_plans p
        ON p.organization_id = s.organization_id AND p.id = s.interview_plan_id
      WHERE s.organization_id = ${organizationId}::uuid
        AND s.id = ${sessionId}::uuid
      LIMIT 1
    `;
    if (!rows[0]) throw new NotFoundException("Interview session not found");
    return this.presentCurrentState(sessionId, rows[0]);
  }

  async transition(sessionId: string, input: InterviewSessionTransitionInputDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const idempotencyKey = input.idempotencyKey.trim();
    const reason = normalizeOptionalText(input.reason);
    const failureCode = normalizeOptionalText(input.failureCode);

    if (input.action === "fail") {
      if (!failureCode) throw new BadRequestException("failureCode is required for fail transitions");
      if (input.recoverable === undefined) {
        throw new BadRequestException("recoverable must be explicitly provided for fail transitions");
      }
    } else if (failureCode !== null || input.recoverable !== undefined) {
      throw new BadRequestException("failureCode and recoverable are only valid for fail transitions");
    }

    const fingerprint = requestFingerprint({
      action: input.action,
      expectedVersion: input.expectedVersion ?? null,
      reason,
      failureCode,
      recoverable: input.recoverable ?? null,
    });

    return this.database.sql.begin(async (transaction) => {
      const sessionRows = await transaction`
        SELECT
          s.id::text,
          s.status,
          s.state_version,
          s.reconnect_count,
          s.recovery_attempt_count,
          s.resume_status,
          s.failure_code,
          s.failure_recoverable,
          s.checkpoint,
          s.started_at,
          s.completed_at,
          s.paused_at,
          s.disconnected_at,
          s.last_failure_at,
          s.last_transition_at,
          p.recovery_policy
        FROM interview_sessions s
        JOIN interview_plans p
          ON p.organization_id = s.organization_id AND p.id = s.interview_plan_id
        WHERE s.organization_id = ${organizationId}::uuid
          AND s.id = ${sessionId}::uuid
        FOR UPDATE OF s
      `;
      const row = sessionRows[0];
      if (!row) throw new NotFoundException("Interview session not found");

      const recoveryPolicy = asRecord(row.recovery_policy);
      const maxReconnects = boundedPolicyLimit(recoveryPolicy.maxReconnects, 3);
      const maxRecoveryAttempts = boundedPolicyLimit(
        recoveryPolicy.maxRecoveryAttempts,
        maxReconnects,
      );
      const current: InterviewSessionMachineState = {
        status: parseStatus(row.status),
        reconnectCount: Math.max(0, Number(row.reconnect_count ?? 0)),
        recoveryAttemptCount: Math.max(0, Number(row.recovery_attempt_count ?? 0)),
        maxReconnects,
        maxRecoveryAttempts,
        resumeStatus: parseResumeStatus(row.resume_status),
        failureCode: row.failure_code ? String(row.failure_code) : null,
        failureRecoverable:
          typeof row.failure_recoverable === "boolean" ? row.failure_recoverable : null,
      };

      const replayRows = await transaction`
        SELECT
          id::text,
          sequence,
          request_fingerprint,
          action,
          from_status,
          to_status,
          state_version,
          reconnect_count,
          recovery_attempt_count,
          resume_status,
          failure_code,
          failure_recoverable,
          occurred_at
        FROM interview_session_state_events
        WHERE organization_id = ${organizationId}::uuid
          AND interview_session_id = ${sessionId}::uuid
          AND idempotency_key = ${idempotencyKey}
        LIMIT 1
      `;
      if (replayRows[0]) {
        const replay = replayRows[0];
        if (String(replay.request_fingerprint) !== fingerprint) {
          throw new ConflictException(
            "The idempotency key was already used for a different interview transition",
          );
        }
        const replayState: InterviewSessionMachineState = {
          status: parseStatus(replay.to_status),
          reconnectCount: Number(replay.reconnect_count ?? 0),
          recoveryAttemptCount: Number(replay.recovery_attempt_count ?? 0),
          maxReconnects,
          maxRecoveryAttempts,
          resumeStatus: parseResumeStatus(replay.resume_status),
          failureCode: replay.failure_code ? String(replay.failure_code) : null,
          failureRecoverable:
            typeof replay.failure_recoverable === "boolean"
              ? replay.failure_recoverable
              : null,
        };
        return {
          ...this.presentMachineState(sessionId, replayState, Number(replay.state_version)),
          transitionedAt: new Date(String(replay.occurred_at)).toISOString(),
          transition: {
            id: String(replay.id),
            sequence: Number(replay.sequence),
            action: String(replay.action),
            fromStatus: String(replay.from_status),
            toStatus: String(replay.to_status),
            idempotentReplay: true,
          },
        };
      }

      const currentVersion = Math.max(0, Number(row.state_version ?? 0));
      if (input.expectedVersion !== undefined && input.expectedVersion !== currentVersion) {
        throw new ConflictException(
          `Interview state version mismatch: expected ${input.expectedVersion}, current ${currentVersion}`,
        );
      }

      let next: InterviewSessionMachineState;
      try {
        next = transitionInterviewSession(current, {
          action: input.action,
          failureCode,
          recoverable: input.recoverable,
        });
      } catch (error) {
        if (error instanceof InterviewSessionTransitionError) {
          throw new ConflictException(error.message);
        }
        throw error;
      }

      const nextVersion = currentVersion + 1;
      const sequenceRows = await transaction`
        SELECT COALESCE(max(sequence), -1)::int + 1 AS next_sequence
        FROM interview_session_state_events
        WHERE organization_id = ${organizationId}::uuid
          AND interview_session_id = ${sessionId}::uuid
      `;
      const sequence = Number(sequenceRows[0]?.next_sequence ?? 0);
      const transitionedAt = new Date().toISOString();
      const checkpoint = asRecord(row.checkpoint);
      const nextCheckpoint = {
        ...checkpoint,
        stateMachine: {
          contractVersion: INTERVIEW_SESSION_STATE_CONTRACT_VERSION,
          stateVersion: nextVersion,
          lastAction: input.action,
          resumeStatus: next.resumeStatus,
          failureCode: next.failureCode,
          failureRecoverable: next.failureRecoverable,
          reconnectCount: next.reconnectCount,
          recoveryAttemptCount: next.recoveryAttemptCount,
          maxReconnects,
          maxRecoveryAttempts,
          lastTransitionAt: transitionedAt,
        },
      };
      const failureOccurred =
        input.action === "fail" ||
        (next.status === "failed" && current.status !== "failed");

      const updatedRows = await transaction`
        UPDATE interview_sessions
        SET
          status = ${next.status},
          state_version = ${nextVersion},
          reconnect_count = ${next.reconnectCount},
          recovery_attempt_count = ${next.recoveryAttemptCount},
          resume_status = ${next.resumeStatus},
          failure_code = ${next.failureCode},
          failure_recoverable = ${next.failureRecoverable},
          checkpoint = ${this.database.sql.json(nextCheckpoint as never)},
          started_at = CASE
            WHEN ${input.action === "start"} THEN COALESCE(started_at, ${transitionedAt}::timestamptz)
            ELSE started_at
          END,
          completed_at = CASE
            WHEN ${next.status === "completed"} THEN COALESCE(completed_at, ${transitionedAt}::timestamptz)
            ELSE completed_at
          END,
          paused_at = CASE WHEN ${next.status === "paused"} THEN ${transitionedAt}::timestamptz ELSE NULL END,
          disconnected_at = CASE WHEN ${next.status === "disconnected"} THEN ${transitionedAt}::timestamptz ELSE NULL END,
          last_failure_at = CASE
            WHEN ${failureOccurred} THEN ${transitionedAt}::timestamptz
            WHEN ${next.failureCode === null} THEN NULL
            ELSE last_failure_at
          END,
          last_transition_at = ${transitionedAt}::timestamptz,
          updated_at = ${transitionedAt}::timestamptz
        WHERE organization_id = ${organizationId}::uuid
          AND id = ${sessionId}::uuid
        RETURNING started_at, completed_at, paused_at, disconnected_at, last_failure_at, last_transition_at
      `;

      const eventRows = await transaction`
        INSERT INTO interview_session_state_events (
          organization_id,
          interview_session_id,
          sequence,
          idempotency_key,
          request_fingerprint,
          action,
          from_status,
          to_status,
          state_version,
          reconnect_count,
          recovery_attempt_count,
          resume_status,
          failure_code,
          failure_recoverable,
          reason,
          occurred_at
        ) VALUES (
          ${organizationId}::uuid,
          ${sessionId}::uuid,
          ${sequence},
          ${idempotencyKey},
          ${fingerprint},
          ${input.action},
          ${current.status},
          ${next.status},
          ${nextVersion},
          ${next.reconnectCount},
          ${next.recoveryAttemptCount},
          ${next.resumeStatus},
          ${next.failureCode},
          ${next.failureRecoverable},
          ${reason},
          ${transitionedAt}::timestamptz
        )
        RETURNING id::text
      `;

      return {
        ...this.presentMachineState(sessionId, next, nextVersion),
        startedAt: this.isoOrNull(updatedRows[0]?.started_at),
        completedAt: this.isoOrNull(updatedRows[0]?.completed_at),
        pausedAt: this.isoOrNull(updatedRows[0]?.paused_at),
        disconnectedAt: this.isoOrNull(updatedRows[0]?.disconnected_at),
        lastFailureAt: this.isoOrNull(updatedRows[0]?.last_failure_at),
        lastTransitionAt: this.isoOrNull(updatedRows[0]?.last_transition_at),
        transitionedAt,
        transition: {
          id: String(eventRows[0]?.id),
          sequence,
          action: input.action,
          fromStatus: current.status,
          toStatus: next.status,
          idempotentReplay: false,
        },
      };
    });
  }

  private presentCurrentState(sessionId: string, row: Record<string, unknown>) {
    const recoveryPolicy = asRecord(row.recovery_policy);
    const maxReconnects = boundedPolicyLimit(recoveryPolicy.maxReconnects, 3);
    const maxRecoveryAttempts = boundedPolicyLimit(
      recoveryPolicy.maxRecoveryAttempts,
      maxReconnects,
    );
    const machine: InterviewSessionMachineState = {
      status: parseStatus(row.status),
      reconnectCount: Math.max(0, Number(row.reconnect_count ?? 0)),
      recoveryAttemptCount: Math.max(0, Number(row.recovery_attempt_count ?? 0)),
      maxReconnects,
      maxRecoveryAttempts,
      resumeStatus: parseResumeStatus(row.resume_status),
      failureCode: row.failure_code ? String(row.failure_code) : null,
      failureRecoverable:
        typeof row.failure_recoverable === "boolean" ? row.failure_recoverable : null,
    };
    return {
      ...this.presentMachineState(sessionId, machine, Math.max(0, Number(row.state_version ?? 0))),
      startedAt: this.isoOrNull(row.started_at),
      completedAt: this.isoOrNull(row.completed_at),
      pausedAt: this.isoOrNull(row.paused_at),
      disconnectedAt: this.isoOrNull(row.disconnected_at),
      lastFailureAt: this.isoOrNull(row.last_failure_at),
      lastTransitionAt: this.isoOrNull(row.last_transition_at),
    };
  }

  private presentMachineState(
    sessionId: string,
    machine: InterviewSessionMachineState,
    stateVersion: number,
  ) {
    return {
      contractVersion: INTERVIEW_SESSION_STATE_CONTRACT_VERSION,
      sessionId,
      status: machine.status,
      stateVersion,
      reconnectCount: machine.reconnectCount,
      recoveryAttemptCount: machine.recoveryAttemptCount,
      maxReconnects: machine.maxReconnects,
      maxRecoveryAttempts: machine.maxRecoveryAttempts,
      resumeStatus: machine.resumeStatus,
      failure: machine.failureCode
        ? {
            code: machine.failureCode,
            recoverable: machine.failureRecoverable === true,
          }
        : null,
      allowedActions: allowedInterviewSessionActions(machine),
      terminal: ["completed", "failed", "cancelled"].includes(machine.status),
    };
  }

  private isoOrNull(value: unknown): string | null {
    return value ? new Date(String(value)).toISOString() : null;
  }
}

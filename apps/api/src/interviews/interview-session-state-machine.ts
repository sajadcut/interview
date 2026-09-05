export const INTERVIEW_SESSION_STATE_CONTRACT_VERSION = "interview-session-state.v1";

export const InterviewSessionStatuses = [
  "invited",
  "in_progress",
  "paused",
  "disconnected",
  "completed",
  "failed",
  "cancelled",
] as const;
export type InterviewSessionStatus = (typeof InterviewSessionStatuses)[number];

export const InterviewSessionTransitionActions = [
  "start",
  "pause",
  "resume",
  "disconnect",
  "reconnect",
  "finish",
  "fail",
  "recover",
  "cancel",
] as const;
export type InterviewSessionTransitionAction = (typeof InterviewSessionTransitionActions)[number];
export type InterviewSessionResumeStatus = "in_progress" | "paused";

export interface InterviewSessionMachineState {
  status: InterviewSessionStatus;
  reconnectCount: number;
  recoveryAttemptCount: number;
  maxReconnects: number;
  maxRecoveryAttempts: number;
  resumeStatus: InterviewSessionResumeStatus | null;
  failureCode: string | null;
  failureRecoverable: boolean | null;
}

export interface InterviewSessionTransitionCommand {
  action: InterviewSessionTransitionAction;
  failureCode?: string | null;
  recoverable?: boolean | undefined;
}

export class InterviewSessionTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InterviewSessionTransitionError";
  }
}

const TERMINAL_STATUSES = new Set<InterviewSessionStatus>(["completed", "failed", "cancelled"]);

function boundedCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function boundedLimit(value: number): number {
  return Number.isFinite(value) ? Math.min(20, Math.max(1, Math.trunc(value))) : 3;
}

function normalizeState(state: InterviewSessionMachineState): InterviewSessionMachineState {
  return {
    ...state,
    reconnectCount: boundedCount(state.reconnectCount),
    recoveryAttemptCount: boundedCount(state.recoveryAttemptCount),
    maxReconnects: boundedLimit(state.maxReconnects),
    maxRecoveryAttempts: boundedLimit(state.maxRecoveryAttempts),
  };
}

function assertStatus(
  state: InterviewSessionMachineState,
  action: InterviewSessionTransitionAction,
  allowed: InterviewSessionStatus[],
): void {
  if (!allowed.includes(state.status)) {
    throw new InterviewSessionTransitionError(
      `Cannot ${action} an interview session while it is ${state.status}`,
    );
  }
}

function terminalFailure(
  state: InterviewSessionMachineState,
  failureCode: string,
): InterviewSessionMachineState {
  return {
    ...state,
    status: "failed",
    resumeStatus: null,
    failureCode,
    failureRecoverable: false,
  };
}

export function isTerminalInterviewSessionStatus(status: InterviewSessionStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function allowedInterviewSessionActions(
  rawState: InterviewSessionMachineState,
): InterviewSessionTransitionAction[] {
  const state = normalizeState(rawState);
  if (isTerminalInterviewSessionStatus(state.status)) return [];

  switch (state.status) {
    case "invited":
      return ["start", "fail", "cancel"];
    case "in_progress":
      return ["pause", "disconnect", "finish", "fail", "cancel"];
    case "paused":
      return ["resume", "disconnect", "finish", "fail", "cancel"];
    case "disconnected":
      return [state.failureCode ? "recover" : "reconnect", "fail", "cancel"];
    default:
      return [];
  }
}

export function transitionInterviewSession(
  rawState: InterviewSessionMachineState,
  command: InterviewSessionTransitionCommand,
): InterviewSessionMachineState {
  const state = normalizeState(rawState);
  if (isTerminalInterviewSessionStatus(state.status)) {
    throw new InterviewSessionTransitionError(
      `Interview session is terminal (${state.status}) and cannot transition again`,
    );
  }

  switch (command.action) {
    case "start":
      assertStatus(state, command.action, ["invited"]);
      return {
        ...state,
        status: "in_progress",
        recoveryAttemptCount: 0,
        resumeStatus: null,
        failureCode: null,
        failureRecoverable: null,
      };

    case "pause":
      assertStatus(state, command.action, ["in_progress"]);
      return {
        ...state,
        status: "paused",
        resumeStatus: null,
        failureCode: null,
        failureRecoverable: null,
      };

    case "resume":
      assertStatus(state, command.action, ["paused"]);
      return {
        ...state,
        status: "in_progress",
        recoveryAttemptCount: 0,
        resumeStatus: null,
        failureCode: null,
        failureRecoverable: null,
      };

    case "disconnect": {
      assertStatus(state, command.action, ["in_progress", "paused"]);
      if (state.reconnectCount >= state.maxReconnects) {
        return terminalFailure(state, "reconnect_exhausted");
      }
      return {
        ...state,
        status: "disconnected",
        recoveryAttemptCount: 0,
        resumeStatus: state.status as InterviewSessionResumeStatus,
        failureCode: null,
        failureRecoverable: null,
      };
    }

    case "reconnect": {
      assertStatus(state, command.action, ["disconnected"]);
      if (state.failureCode) {
        throw new InterviewSessionTransitionError(
          "Recoverable failures must use the recover action instead of reconnect",
        );
      }
      if (state.reconnectCount >= state.maxReconnects) {
        return terminalFailure(state, "reconnect_exhausted");
      }
      return {
        ...state,
        status: state.resumeStatus ?? "in_progress",
        reconnectCount: state.reconnectCount + 1,
        recoveryAttemptCount: 0,
        resumeStatus: null,
        failureCode: null,
        failureRecoverable: null,
      };
    }

    case "finish":
      assertStatus(state, command.action, ["in_progress", "paused"]);
      return {
        ...state,
        status: "completed",
        recoveryAttemptCount: 0,
        resumeStatus: null,
        failureCode: null,
        failureRecoverable: null,
      };

    case "fail": {
      const failureCode = command.failureCode?.trim() ?? "";
      if (!failureCode) {
        throw new InterviewSessionTransitionError("Failure transitions require a failureCode");
      }
      if (command.recoverable === undefined) {
        throw new InterviewSessionTransitionError(
          "Failure transitions require an explicit recoverable flag",
        );
      }
      if (!command.recoverable) return terminalFailure(state, failureCode);
      assertStatus(state, command.action, ["in_progress", "paused", "disconnected"]);

      const recoveryAttemptCount = state.recoveryAttemptCount + 1;
      if (recoveryAttemptCount >= state.maxRecoveryAttempts) {
        return terminalFailure(
          { ...state, recoveryAttemptCount },
          "recovery_exhausted",
        );
      }
      return {
        ...state,
        status: "disconnected",
        recoveryAttemptCount,
        resumeStatus:
          state.status === "disconnected"
            ? state.resumeStatus ?? "in_progress"
            : state.status as InterviewSessionResumeStatus,
        failureCode,
        failureRecoverable: true,
      };
    }

    case "recover": {
      assertStatus(state, command.action, ["disconnected"]);
      if (!state.failureCode || state.failureRecoverable !== true) {
        throw new InterviewSessionTransitionError(
          "The disconnected session has no recoverable failure to recover from",
        );
      }
      if (state.reconnectCount >= state.maxReconnects) {
        return terminalFailure(state, "reconnect_exhausted");
      }
      return {
        ...state,
        status: state.resumeStatus ?? "in_progress",
        reconnectCount: state.reconnectCount + 1,
        recoveryAttemptCount: 0,
        resumeStatus: null,
        failureCode: null,
        failureRecoverable: null,
      };
    }

    case "cancel":
      assertStatus(state, command.action, ["invited", "in_progress", "paused", "disconnected"]);
      return {
        ...state,
        status: "cancelled",
        resumeStatus: null,
        failureCode: null,
        failureRecoverable: null,
      };
  }
}

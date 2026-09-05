export const CandidateInterviewPhases = [
  "permissions",
  "ready",
  "connecting",
  "live",
  "reconnecting",
  "offline",
  "degraded",
  "fatal",
  "completed",
] as const;

export type CandidateInterviewPhase = (typeof CandidateInterviewPhases)[number];

export const CandidateMediaPermissionStates = [
  "unknown",
  "prompt",
  "granted",
  "denied",
  "unavailable",
] as const;

export type CandidateMediaPermissionState = (typeof CandidateMediaPermissionStates)[number];
export type CandidateNetworkState = "online" | "offline";

export const CandidateInterviewErrorCodes = [
  "permission_denied",
  "device_unavailable",
  "network_offline",
  "runtime_unavailable",
  "transport_timeout",
  "transport_unavailable",
  "reconnect_exhausted",
  "session_expired",
  "consent_required",
  "unexpected",
] as const;

export type CandidateInterviewErrorCode = (typeof CandidateInterviewErrorCodes)[number];
export type CandidateInterviewErrorSeverity = "recoverable" | "fatal";

export interface CandidateInterviewError {
  code: CandidateInterviewErrorCode;
  severity: CandidateInterviewErrorSeverity;
}

export interface CandidateInterviewState {
  phase: CandidateInterviewPhase;
  network: CandidateNetworkState;
  microphone: CandidateMediaPermissionState;
  camera: CandidateMediaPermissionState;
  audioOnly: boolean;
  runtimeAvailable: boolean;
  hasConnected: boolean;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
  error: CandidateInterviewError | null;
  resumePhase: Exclude<CandidateInterviewPhase, "offline"> | null;
}

export type CandidateInterviewEvent =
  | { type: "BOOTSTRAP"; online: boolean; runtimeAvailable: boolean }
  | {
      type: "PERMISSIONS_RESOLVED";
      microphone: CandidateMediaPermissionState;
      camera: CandidateMediaPermissionState;
      audioOnly?: boolean;
    }
  | { type: "PERMISSION_FAILED"; code: "permission_denied" | "device_unavailable" }
  | { type: "AUDIO_ONLY_SELECTED" }
  | { type: "RUNTIME_AVAILABILITY_CHANGED"; available: boolean }
  | { type: "CONNECT_REQUESTED" }
  | { type: "CONNECTED" }
  | { type: "TRANSPORT_RECONNECTING" }
  | { type: "TRANSPORT_RECONNECTED" }
  | {
      type: "CONNECTION_FAILED";
      code: "transport_timeout" | "transport_unavailable" | "unexpected";
    }
  | { type: "NETWORK_OFFLINE" }
  | { type: "NETWORK_ONLINE" }
  | { type: "SESSION_EXPIRED" }
  | { type: "CONSENT_REQUIRED" }
  | { type: "COMPLETE" }
  | { type: "RESET_RECOVERABLE_ERROR" };

export type CandidateInterviewFallback =
  | "review_permissions"
  | "audio_only"
  | "retry_connection"
  | "resume_later";

const TERMINAL_PHASES = new Set<CandidateInterviewPhase>(["fatal", "completed"]);

export function createCandidateInterviewState(input?: {
  online?: boolean;
  runtimeAvailable?: boolean;
  maxReconnectAttempts?: number;
}): CandidateInterviewState {
  const online = input?.online ?? true;
  return {
    phase: online ? "permissions" : "offline",
    network: online ? "online" : "offline",
    microphone: "unknown",
    camera: "unknown",
    audioOnly: false,
    runtimeAvailable: input?.runtimeAvailable ?? false,
    hasConnected: false,
    reconnectAttempts: 0,
    maxReconnectAttempts: Math.max(1, input?.maxReconnectAttempts ?? 3),
    error: online ? null : { code: "network_offline", severity: "recoverable" },
    resumePhase: online ? null : "permissions",
  };
}

export function mediaPermissionReady(state: CandidateInterviewState): boolean {
  return state.microphone === "granted" && (state.camera === "granted" || state.audioOnly);
}

function phaseForPermissions(state: CandidateInterviewState): Exclude<CandidateInterviewPhase, "offline"> {
  return mediaPermissionReady(state) ? "ready" : "permissions";
}

function preserveOffline(
  state: CandidateInterviewState,
  nextPhase: Exclude<CandidateInterviewPhase, "offline">,
): Pick<CandidateInterviewState, "phase" | "resumePhase"> {
  return state.network === "offline"
    ? { phase: "offline", resumePhase: nextPhase }
    : { phase: nextPhase, resumePhase: null };
}

function terminal(state: CandidateInterviewState): boolean {
  return TERMINAL_PHASES.has(state.phase);
}

export function canAttemptCandidateInterviewConnection(state: CandidateInterviewState): boolean {
  return (
    !terminal(state) &&
    state.network === "online" &&
    state.runtimeAvailable &&
    mediaPermissionReady(state) &&
    !["connecting", "live", "reconnecting"].includes(state.phase)
  );
}

export function candidateInterviewFallbacks(
  state: CandidateInterviewState,
): CandidateInterviewFallback[] {
  if (terminal(state)) return [];
  const fallbacks = new Set<CandidateInterviewFallback>();

  if (state.microphone !== "granted") fallbacks.add("review_permissions");
  if (!state.audioOnly && state.camera !== "granted") fallbacks.add("audio_only");
  if (
    state.network === "online" &&
    state.runtimeAvailable &&
    mediaPermissionReady(state) &&
    ["reconnecting", "degraded"].includes(state.phase) &&
    state.reconnectAttempts < state.maxReconnectAttempts
  ) {
    fallbacks.add("retry_connection");
  }
  if (
    state.error?.code === "runtime_unavailable" ||
    state.error?.code === "reconnect_exhausted" ||
    (state.phase === "degraded" && state.reconnectAttempts >= state.maxReconnectAttempts)
  ) {
    fallbacks.add("resume_later");
  }
  return [...fallbacks];
}

export function candidateInterviewReducer(
  state: CandidateInterviewState,
  event: CandidateInterviewEvent,
): CandidateInterviewState {
  if (terminal(state) && event.type !== "COMPLETE") return state;

  switch (event.type) {
    case "BOOTSTRAP": {
      if (!event.online) {
        return {
          ...state,
          runtimeAvailable: event.runtimeAvailable,
          network: "offline",
          phase: "offline",
          resumePhase: state.phase === "offline" ? state.resumePhase ?? "permissions" : state.phase,
          error: { code: "network_offline", severity: "recoverable" },
        };
      }
      return {
        ...state,
        runtimeAvailable: event.runtimeAvailable,
        network: "online",
        phase: phaseForPermissions(state),
        resumePhase: null,
        error: null,
      };
    }

    case "PERMISSIONS_RESOLVED": {
      const next: CandidateInterviewState = {
        ...state,
        microphone: event.microphone,
        camera: event.camera,
        audioOnly: event.audioOnly ?? state.audioOnly,
        error: null,
      };
      const permissionPhase = phaseForPermissions(next);
      const visibility = preserveOffline(next, permissionPhase);
      return { ...next, ...visibility };
    }

    case "PERMISSION_FAILED": {
      const visibility = preserveOffline(state, "permissions");
      return {
        ...state,
        ...visibility,
        error: { code: event.code, severity: "recoverable" },
      };
    }

    case "AUDIO_ONLY_SELECTED": {
      const next = { ...state, audioOnly: true, camera: state.camera === "granted" ? "granted" : "unavailable" } satisfies CandidateInterviewState;
      const visibility = preserveOffline(next, phaseForPermissions(next));
      return { ...next, ...visibility, error: null };
    }

    case "RUNTIME_AVAILABILITY_CHANGED": {
      if (!event.available && state.phase === "live") {
        return {
          ...state,
          runtimeAvailable: false,
          phase: "degraded",
          error: { code: "runtime_unavailable", severity: "recoverable" },
        };
      }
      const recoverFromUnavailable =
        event.available && state.phase === "degraded" && state.error?.code === "runtime_unavailable";
      return {
        ...state,
        runtimeAvailable: event.available,
        ...(recoverFromUnavailable
          ? { phase: phaseForPermissions(state), error: null, reconnectAttempts: 0 }
          : {}),
      };
    }

    case "CONNECT_REQUESTED": {
      if (state.network === "offline") {
        return {
          ...state,
          phase: "offline",
          error: { code: "network_offline", severity: "recoverable" },
        };
      }
      if (!mediaPermissionReady(state)) {
        return {
          ...state,
          phase: "permissions",
          error: { code: "permission_denied", severity: "recoverable" },
        };
      }
      if (!state.runtimeAvailable) {
        return {
          ...state,
          phase: "degraded",
          error: { code: "runtime_unavailable", severity: "recoverable" },
        };
      }
      return { ...state, phase: "connecting", error: null };
    }

    case "CONNECTED":
      return {
        ...state,
        phase: "live",
        hasConnected: true,
        reconnectAttempts: 0,
        error: null,
        resumePhase: null,
      };

    case "TRANSPORT_RECONNECTING":
      return {
        ...state,
        phase: state.network === "offline" ? "offline" : "reconnecting",
        resumePhase: state.network === "offline" ? "reconnecting" : null,
        hasConnected: true,
        error: { code: "transport_unavailable", severity: "recoverable" },
      };

    case "TRANSPORT_RECONNECTED":
      return {
        ...state,
        phase: "live",
        hasConnected: true,
        reconnectAttempts: 0,
        error: null,
        resumePhase: null,
      };

    case "CONNECTION_FAILED": {
      const reconnectAttempts = state.reconnectAttempts + 1;
      if (reconnectAttempts >= state.maxReconnectAttempts) {
        return {
          ...state,
          phase: "degraded",
          reconnectAttempts,
          error: { code: "reconnect_exhausted", severity: "recoverable" },
        };
      }
      return {
        ...state,
        phase: state.network === "offline" ? "offline" : "reconnecting",
        resumePhase: state.network === "offline" ? "reconnecting" : null,
        reconnectAttempts,
        error: { code: event.code, severity: "recoverable" },
      };
    }

    case "NETWORK_OFFLINE": {
      if (state.network === "offline") return state;
      const resumePhase = state.phase === "offline" ? state.resumePhase ?? "permissions" : state.phase;
      return {
        ...state,
        network: "offline",
        phase: "offline",
        resumePhase,
        error: { code: "network_offline", severity: "recoverable" },
      };
    }

    case "NETWORK_ONLINE": {
      if (state.network === "online") return state;
      const recoveredPhase = state.hasConnected
        ? "reconnecting"
        : state.resumePhase === null
          ? phaseForPermissions(state)
          : state.resumePhase;
      return {
        ...state,
        network: "online",
        phase: recoveredPhase,
        resumePhase: null,
        error:
          recoveredPhase === "reconnecting"
            ? { code: "transport_unavailable", severity: "recoverable" }
            : state.error?.code === "network_offline"
              ? null
              : state.error,
      };
    }

    case "SESSION_EXPIRED":
      return {
        ...state,
        phase: "fatal",
        error: { code: "session_expired", severity: "fatal" },
        resumePhase: null,
      };

    case "CONSENT_REQUIRED":
      return {
        ...state,
        phase: "fatal",
        error: { code: "consent_required", severity: "fatal" },
        resumePhase: null,
      };

    case "COMPLETE":
      return { ...state, phase: "completed", error: null, resumePhase: null };

    case "RESET_RECOVERABLE_ERROR": {
      if (state.error?.severity !== "recoverable") return state;
      const nextPhase = state.network === "offline" ? "offline" : phaseForPermissions(state);
      return {
        ...state,
        phase: nextPhase,
        error: state.network === "offline" ? state.error : null,
        reconnectAttempts: state.network === "offline" ? state.reconnectAttempts : 0,
        resumePhase: state.network === "offline" ? phaseForPermissions(state) : null,
      };
    }
  }
}

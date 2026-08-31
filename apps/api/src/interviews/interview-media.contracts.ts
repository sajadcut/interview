export const RealtimeMediaModes = ["audio", "avatar"] as const;
export type RealtimeMediaMode = (typeof RealtimeMediaModes)[number];

export const MediaComponents = ["transport", "vad", "stt", "tts", "avatar"] as const;
export type MediaComponent = (typeof MediaComponents)[number];

export interface MediaProviderStatus {
  component: MediaComponent;
  provider: string;
  configured: boolean;
  reachable: boolean;
  ready: boolean;
  version?: string;
  reason?: string;
  checkedAt?: string;
}

export interface RealtimeMediaReadinessInput {
  enabled: boolean;
  mode: RealtimeMediaMode;
  providers: MediaProviderStatus[];
}

export interface RealtimeMediaReadiness {
  enabled: boolean;
  mode: RealtimeMediaMode;
  ready: boolean;
  blockers: string[];
  providers: MediaProviderStatus[];
  requiredComponents: MediaComponent[];
  privacy: {
    candidateVideoAnalysis: "none";
    biometricInferenceAllowed: false;
    rawMediaPersistedByApi: false;
    spokenTextOnlyToAvatar: true;
  };
}

const BASE_REQUIRED_COMPONENTS: MediaComponent[] = ["transport", "vad", "stt", "tts"];

export function requiredMediaComponents(mode: RealtimeMediaMode): MediaComponent[] {
  return mode === "avatar" ? [...BASE_REQUIRED_COMPONENTS, "avatar"] : [...BASE_REQUIRED_COMPONENTS];
}

export function evaluateRealtimeMediaReadiness(
  input: RealtimeMediaReadinessInput,
): RealtimeMediaReadiness {
  const requiredComponents = requiredMediaComponents(input.mode);
  const byComponent = new Map(input.providers.map((provider) => [provider.component, provider]));
  const blockers: string[] = [];

  if (!input.enabled) blockers.push("Realtime media is disabled by configuration.");

  for (const component of requiredComponents) {
    const provider = byComponent.get(component);
    if (!provider) {
      blockers.push(`${component}: provider status is missing.`);
      continue;
    }
    if (!provider.configured) {
      blockers.push(`${component}: ${provider.provider || "provider"} is not configured.`);
      continue;
    }
    if (!provider.reachable) {
      blockers.push(`${component}: ${provider.provider} is not reachable.`);
      continue;
    }
    if (!provider.ready) {
      blockers.push(`${component}: ${provider.provider} is not ready${provider.reason ? ` (${provider.reason})` : ""}.`);
    }
  }

  return {
    enabled: input.enabled,
    mode: input.mode,
    ready: blockers.length === 0,
    blockers,
    providers: input.providers,
    requiredComponents,
    privacy: {
      candidateVideoAnalysis: "none",
      biometricInferenceAllowed: false,
      rawMediaPersistedByApi: false,
      spokenTextOnlyToAvatar: true,
    },
  };
}

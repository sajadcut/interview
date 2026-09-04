import type { AppEnv } from "../config/env";
import type { MediaComponent, MediaProviderStatus } from "./interview-media.contracts";

export interface MediaProviderDescriptor {
  component: MediaComponent;
  provider: string;
  configured: boolean;
  healthUrl: string | null;
  version?: string;
  configurationReason: string | undefined;
}

export type MediaHealthFetcher = (url: string, init?: RequestInit) => Promise<Response>;

function trimUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.replace(/\/$/, "") : null;
}

function httpHealthUrl(baseUrl: string | undefined): string | null {
  const base = trimUrl(baseUrl);
  return base ? `${base}/health` : null;
}

export function buildMediaProviderDescriptors(env: AppEnv): MediaProviderDescriptor[] {
  const livekitConfigured =
    env.MEDIA_TRANSPORT_PROVIDER === "livekit" &&
    Boolean(env.LIVEKIT_URL) &&
    Boolean(env.LIVEKIT_HEALTH_URL) &&
    Boolean(env.LIVEKIT_API_KEY) &&
    Boolean(env.LIVEKIT_API_SECRET);

  return [
    {
      component: "transport",
      provider: env.MEDIA_TRANSPORT_PROVIDER,
      configured: livekitConfigured,
      healthUrl: trimUrl(env.LIVEKIT_HEALTH_URL),
      configurationReason:
        env.MEDIA_TRANSPORT_PROVIDER === "disabled"
          ? "transport provider is disabled"
          : livekitConfigured
            ? undefined
            : "LIVEKIT_URL, LIVEKIT_HEALTH_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET are required",
    },
    {
      component: "vad",
      provider: env.VAD_PROVIDER,
      configured: env.VAD_PROVIDER !== "disabled" && Boolean(env.VAD_BASE_URL),
      healthUrl: httpHealthUrl(env.VAD_BASE_URL),
      configurationReason:
        env.VAD_PROVIDER === "disabled"
          ? "VAD provider is disabled"
          : env.VAD_BASE_URL
            ? undefined
            : "VAD_BASE_URL is required",
    },
    {
      component: "stt",
      provider: env.STT_PROVIDER,
      configured: env.STT_PROVIDER !== "disabled" && Boolean(env.STT_BASE_URL),
      healthUrl: httpHealthUrl(env.STT_BASE_URL),
      configurationReason:
        env.STT_PROVIDER === "disabled"
          ? "STT provider is disabled"
          : env.STT_BASE_URL
            ? undefined
            : "STT_BASE_URL is required",
    },
    {
      component: "tts",
      provider: env.TTS_PROVIDER,
      configured: env.TTS_PROVIDER !== "disabled" && Boolean(env.TTS_BASE_URL),
      healthUrl: httpHealthUrl(env.TTS_BASE_URL),
      configurationReason:
        env.TTS_PROVIDER === "disabled"
          ? "TTS provider is disabled"
          : env.TTS_BASE_URL
            ? undefined
            : "TTS_BASE_URL is required",
    },
    {
      component: "avatar",
      provider: env.AVATAR_PROVIDER,
      configured: env.AVATAR_PROVIDER !== "disabled" && Boolean(env.AVATAR_BASE_URL),
      healthUrl: httpHealthUrl(env.AVATAR_BASE_URL),
      configurationReason:
        env.AVATAR_PROVIDER === "disabled"
          ? "avatar provider is disabled"
          : env.AVATAR_BASE_URL
            ? undefined
            : "AVATAR_BASE_URL is required",
    },
  ];
}

export async function probeMediaProviders(
  descriptors: MediaProviderDescriptor[],
  timeoutMs: number,
  fetcher: MediaHealthFetcher = (url, init) => fetch(url, init),
): Promise<MediaProviderStatus[]> {
  return Promise.all(
    descriptors.map(async (descriptor): Promise<MediaProviderStatus> => {
      if (!descriptor.configured) {
        return {
          component: descriptor.component,
          provider: descriptor.provider,
          configured: false,
          reachable: false,
          ready: false,
          ...(descriptor.version ? { version: descriptor.version } : {}),
          reason: descriptor.configurationReason ?? "provider is not configured",
          checkedAt: new Date().toISOString(),
        };
      }

      if (!descriptor.healthUrl) {
        return {
          component: descriptor.component,
          provider: descriptor.provider,
          configured: true,
          reachable: false,
          ready: false,
          ...(descriptor.version ? { version: descriptor.version } : {}),
          reason: "health probe URL is not configured",
          checkedAt: new Date().toISOString(),
        };
      }

      try {
        const response = await fetcher(descriptor.healthUrl, {
          method: "GET",
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(timeoutMs),
          cache: "no-store",
        });
        const version = response.headers.get("x-provider-version")?.trim() || descriptor.version;
        return {
          component: descriptor.component,
          provider: descriptor.provider,
          configured: true,
          reachable: true,
          ready: response.ok,
          ...(version ? { version } : {}),
          ...(!response.ok ? { reason: `health probe returned HTTP ${response.status}` } : {}),
          checkedAt: new Date().toISOString(),
        };
      } catch (cause) {
        return {
          component: descriptor.component,
          provider: descriptor.provider,
          configured: true,
          reachable: false,
          ready: false,
          ...(descriptor.version ? { version: descriptor.version } : {}),
          reason: cause instanceof Error ? cause.message : "health probe failed",
          checkedAt: new Date().toISOString(),
        };
      }
    }),
  );
}

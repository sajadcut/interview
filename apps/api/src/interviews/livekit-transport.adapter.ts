import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { getEnv } from "../config/env";
import { createLiveKitJoinToken } from "./livekit-access-token";
import type {
  RealtimeTransportAdapter,
  RealtimeTransportCredential,
  RealtimeTransportParticipant,
  RealtimeTransportRoomRequest,
} from "./realtime-transport.adapter";

function normalizeProbeFailure(cause: unknown): string {
  if (cause instanceof DOMException && cause.name === "TimeoutError") return "timeout";
  if (cause instanceof Error && /timeout/i.test(cause.name)) return "timeout";
  return "unreachable";
}

@Injectable()
export class LiveKitTransportAdapter implements RealtimeTransportAdapter {
  readonly providerKey = "livekit";

  get enabled(): boolean {
    return getEnv().MEDIA_TRANSPORT_PROVIDER === "livekit";
  }

  get configured(): boolean {
    const env = getEnv();
    return (
      env.MEDIA_TRANSPORT_PROVIDER === "livekit" &&
      Boolean(env.LIVEKIT_URL && env.LIVEKIT_HEALTH_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET)
    );
  }

  deploymentStatus() {
    const env = getEnv();
    return {
      provider: this.providerKey,
      enabled: this.enabled,
      configured: this.configured,
      healthCheckConfigured: Boolean(env.LIVEKIT_HEALTH_URL),
      turnConfigured: Boolean(env.TURN_URLS.trim()),
      tokenTtlSeconds: env.LIVEKIT_TOKEN_TTL_SECONDS,
    };
  }

  async readiness(): Promise<{ reachable: boolean; ready: boolean; reason?: string }> {
    const env = getEnv();
    if (!this.enabled) return { reachable: false, ready: false, reason: "transport_disabled" };
    if (!this.configured || !env.LIVEKIT_HEALTH_URL) {
      return { reachable: false, ready: false, reason: "not_configured" };
    }

    try {
      const response = await fetch(env.LIVEKIT_HEALTH_URL, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(env.MEDIA_PROVIDER_TIMEOUT_MS),
        cache: "no-store",
      });
      if (!response.ok) {
        return { reachable: true, ready: false, reason: `http_${response.status}` };
      }
      return { reachable: true, ready: true };
    } catch (cause) {
      return { reachable: false, ready: false, reason: normalizeProbeFailure(cause) };
    }
  }

  async issueCredential(
    room: RealtimeTransportRoomRequest,
    participant: RealtimeTransportParticipant,
  ): Promise<RealtimeTransportCredential> {
    const env = getEnv();
    if (!this.enabled || !this.configured || !env.LIVEKIT_URL) {
      throw new ServiceUnavailableException("LiveKit transport is not configured");
    }

    const readiness = await this.readiness();
    if (!readiness.ready) {
      throw new ServiceUnavailableException({
        message: "LiveKit transport is not ready",
        reason: readiness.reason ?? "unavailable",
      });
    }

    const credential = createLiveKitJoinToken({
      apiKey: env.LIVEKIT_API_KEY,
      apiSecret: env.LIVEKIT_API_SECRET,
      room: room.roomReference,
      participantIdentity: participant.participantKey,
      validForSeconds: env.LIVEKIT_TOKEN_TTL_SECONDS,
    });

    return {
      provider: this.providerKey,
      serverUrl: env.LIVEKIT_URL,
      roomReference: room.roomReference,
      participantKey: credential.participantIdentity,
      accessToken: credential.token,
      expiresAt: credential.expiresAt,
      permissions: credential.permissions,
    };
  }
}

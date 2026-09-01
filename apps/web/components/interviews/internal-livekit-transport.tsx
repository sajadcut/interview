"use client";

import { useEffect, useRef, useState } from "react";
import { Room, RoomEvent } from "livekit-client";

type TransportState = "idle" | "preflighting" | "connecting" | "connected" | "reconnecting" | "disconnected" | "error";

type Props = {
  sessionId: string;
  organizationId: string;
  userId: string;
};

type MediaSession = {
  id: string;
  roomReference: string;
};

type ConnectionCredential = {
  transport: "livekit";
  serverUrl: string;
  roomReference: string;
  accessToken: string;
  expiresAt: string;
  participantIdentity: string;
};

const apiUrl = "/api/backend";

function headers(organizationId: string, userId: string): HeadersInit {
  return {
    "content-type": "application/json",
    "x-organization-id": organizationId,
    "x-user-id": userId,
  };
}

async function json<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const message = Array.isArray(data.message)
      ? data.message.filter((item): item is string => typeof item === "string").join("; ")
      : typeof data.message === "string"
        ? data.message
        : `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return data as T;
}

export function InternalLiveKitTransport({ sessionId, organizationId, userId }: Props) {
  const [state, setState] = useState<TransportState>("idle");
  const [mediaSessionId, setMediaSessionId] = useState<string | null>(null);
  const [roomReference, setRoomReference] = useState<string | null>(null);
  const [message, setMessage] = useState("LiveKit transport has not been started for this synthetic session.");
  const roomRef = useRef<Room | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const manualClosingRef = useRef(false);

  async function appendEvent(
    activeMediaSessionId: string,
    eventType: string,
    payload: Record<string, unknown> = {},
  ) {
    const response = await fetch(
      `${apiUrl}/v1/interviews/${sessionId}/media/sessions/${activeMediaSessionId}/events`,
      {
        method: "POST",
        headers: headers(organizationId, userId),
        body: JSON.stringify({ eventType, sourceComponent: "transport", payload }),
      },
    );
    await json(response);
  }

  function stopHeartbeat() {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = null;
  }

  function startHeartbeat(activeMediaSessionId: string) {
    stopHeartbeat();
    heartbeatRef.current = setInterval(() => {
      void appendEvent(activeMediaSessionId, "heartbeat", { state: "connected" }).catch(() => undefined);
    }, 15_000);
  }

  async function disconnect() {
    manualClosingRef.current = true;
    stopHeartbeat();
    const activeMediaSessionId = mediaSessionId;
    const room = roomRef.current;
    roomRef.current = null;
    if (activeMediaSessionId) {
      await appendEvent(activeMediaSessionId, "ended", { reason: "internal_harness_disconnect" }).catch(() => undefined);
    }
    if (room) await room.disconnect();
    setState("disconnected");
    setMessage("LiveKit transport disconnected and media lifecycle marked ended.");
  }

  async function connect() {
    setState("preflighting");
    setMessage("Running consent, release and provider preflight…");
    manualClosingRef.current = false;
    try {
      const preflight = await json<{ ready: boolean; blockers: string[] }>(
        await fetch(`${apiUrl}/v1/interviews/${sessionId}/media/preflight`, {
          method: "POST",
          headers: headers(organizationId, userId),
          body: JSON.stringify({ mode: "audio" }),
        }),
      );
      if (!preflight.ready) throw new Error(preflight.blockers.join("; "));

      const mediaSession = await json<MediaSession>(
        await fetch(`${apiUrl}/v1/interviews/${sessionId}/media/sessions`, {
          method: "POST",
          headers: headers(organizationId, userId),
          body: JSON.stringify({ mode: "audio" }),
        }),
      );
      setMediaSessionId(mediaSession.id);
      setRoomReference(mediaSession.roomReference);

      const credential = await json<ConnectionCredential>(
        await fetch(`${apiUrl}/v1/interviews/${sessionId}/media/sessions/${mediaSession.id}/connection`, {
          method: "POST",
          headers: headers(organizationId, userId),
        }),
      );

      setState("connecting");
      setMessage(`Connecting to opaque room ${credential.roomReference}…`);
      await appendEvent(mediaSession.id, "connecting", { transport: "livekit" });

      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;
      room.on(RoomEvent.Reconnecting, () => {
        setState("reconnecting");
        setMessage("LiveKit is reconnecting. Brain state remains persisted in the API checkpoint.");
        void appendEvent(mediaSession.id, "degraded", { reason: "livekit_reconnecting" }).catch(() => undefined);
      });
      room.on(RoomEvent.Reconnected, () => {
        setState("connected");
        setMessage("LiveKit reconnected to the same persisted interview/media session.");
        startHeartbeat(mediaSession.id);
        void appendEvent(mediaSession.id, "reconnected", { transport: "livekit" }).catch(() => undefined);
      });
      room.on(RoomEvent.Disconnected, () => {
        stopHeartbeat();
        if (manualClosingRef.current) return;
        setState("disconnected");
        setMessage("LiveKit disconnected unexpectedly. Reconnect requires a fresh short-lived credential.");
        void appendEvent(mediaSession.id, "disconnected", { reason: "livekit_disconnected" }).catch(() => undefined);
      });

      await room.connect(credential.serverUrl, credential.accessToken);
      await Promise.all([
        room.localParticipant.setMicrophoneEnabled(true),
        room.localParticipant.setCameraEnabled(true),
      ]);
      await appendEvent(mediaSession.id, "connected", { transport: "livekit" });
      startHeartbeat(mediaSession.id);
      setState("connected");
      setMessage("Connected to self-hosted LiveKit. Camera/microphone tracks are transport only; no biometric inference is performed.");
    } catch (error) {
      stopHeartbeat();
      setState("error");
      const detail = error instanceof Error ? error.message : "Unknown LiveKit connection error";
      setMessage(detail);
      if (mediaSessionId) {
        void appendEvent(mediaSessionId, "error", { message: detail, fatal: false }).catch(() => undefined);
      }
      const room = roomRef.current;
      roomRef.current = null;
      if (room) await room.disconnect().catch(() => undefined);
    }
  }

  useEffect(() => {
    return () => {
      manualClosingRef.current = true;
      stopHeartbeat();
      void roomRef.current?.disconnect();
      roomRef.current = null;
    };
  }, []);

  const busy = state === "preflighting" || state === "connecting" || state === "reconnecting";
  const connected = state === "connected";

  return (
    <section className="rounded-[14px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[.12em] text-indigo-600">Realtime transport · internal only</div>
          <div className="mt-1 text-[13px] font-semibold text-slate-900">LiveKit room connection</div>
          <p className="mt-1 max-w-2xl text-[10px] leading-5 text-slate-500">Short-lived room-scoped credential → browser WebRTC → reconnect/heartbeat events persisted against the synthetic session.</p>
        </div>
        <span className={`rounded-full px-3 py-1.5 text-[9px] font-semibold ${connected ? "bg-emerald-50 text-emerald-700" : state === "error" ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-600"}`}>{state}</span>
      </div>

      <div className="mt-4 rounded-[10px] bg-slate-50 p-3 text-[10px] leading-5 text-slate-600">{message}</div>
      {mediaSessionId ? (
        <div className="mt-3 grid gap-2 text-[9px] text-slate-500 sm:grid-cols-2">
          <div className="rounded-[9px] border border-slate-100 px-3 py-2"><span className="text-slate-400">Media session</span><div className="mt-1 break-all font-mono">{mediaSessionId}</div></div>
          <div className="rounded-[9px] border border-slate-100 px-3 py-2"><span className="text-slate-400">Opaque room</span><div className="mt-1 break-all font-mono">{roomReference ?? "—"}</div></div>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" disabled={busy || connected} onClick={connect} className="h-9 rounded-[9px] bg-indigo-600 px-4 text-[10px] font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300">{busy ? "Connecting…" : connected ? "Connected" : "Connect LiveKit"}</button>
        <button type="button" disabled={!connected} onClick={() => void disconnect()} className="h-9 rounded-[9px] border border-slate-200 bg-white px-4 text-[10px] font-semibold text-slate-600 disabled:cursor-not-allowed disabled:text-slate-300">Disconnect</button>
      </div>
    </section>
  );
}

"use client";

import { Room, RoomEvent, Track } from "livekit-client";

const candidateApi = "/api/candidate-interview";

type CandidateSpeaker = "candidate" | "interviewer";

export type CandidateRuntimeTurn = {
  id: string;
  action: string;
  criterion: string | null;
  spokenText: string;
};

export type CandidateRuntimeSnapshot = {
  status: "active" | "completed";
  sessionId: string;
  mediaSessionId: string;
  remainingSeconds: number;
  releaseMode: string;
  interviewer: {
    name: string;
    subtitle: string;
    avatarVideoAvailable: boolean;
  };
  turn: CandidateRuntimeTurn;
  transcript: Array<{ speaker: CandidateSpeaker; text: string }>;
  privacy: {
    rawMediaPersisted: false;
    candidateVideoAnalysis: "none";
    biometricInferenceAllowed: false;
  };
};

export type CandidateRuntimeAnswer = {
  candidateText: string;
  remainingSeconds: number;
  completed: boolean;
  turn: CandidateRuntimeTurn;
};

export type CandidateRuntimeVoiceAnswer = Partial<CandidateRuntimeAnswer> & {
  speechDetected: boolean;
  durationSeconds: number;
  transcript: null | { text: string; language: string; provider: string };
};

export type CandidateRuntimeEvent =
  | { type: "snapshot"; snapshot: CandidateRuntimeSnapshot }
  | { type: "remote_video"; track: MediaStreamTrack | null }
  | { type: "remote_audio"; track: MediaStreamTrack | null }
  | { type: "reconnecting" }
  | { type: "reconnected" }
  | { type: "disconnected" };

type StartResponse = CandidateRuntimeSnapshot & {
  developmentPreview: boolean;
  connection: {
    transport: "livekit";
    serverUrl: string;
    roomReference: string;
    accessToken: string;
    expiresAt: string;
  };
};

async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const raw = data.message;
    const message = Array.isArray(raw)
      ? raw.map(String).join("; ")
      : typeof raw === "string"
        ? raw
        : typeof data.error === "string"
          ? data.error
          : `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return data as T;
}

class CandidateBrowserRealtimeRuntime {
  private room: Room | null = null;
  private snapshot: CandidateRuntimeSnapshot | null = null;
  private readonly listeners = new Set<(event: CandidateRuntimeEvent) => void>();

  constructor(private readonly developmentPreview: boolean) {}

  subscribe(listener: (event: CandidateRuntimeEvent) => void): () => void {
    this.listeners.add(listener);
    if (this.snapshot) listener({ type: "snapshot", snapshot: this.snapshot });
    return () => this.listeners.delete(listener);
  }

  private emit(event: CandidateRuntimeEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private attachRoomEvents(room: Room): void {
    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === Track.Kind.Video) {
        this.emit({ type: "remote_video", track: track.mediaStreamTrack });
      } else if (track.kind === Track.Kind.Audio) {
        this.emit({ type: "remote_audio", track: track.mediaStreamTrack });
      }
    });
    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      if (track.kind === Track.Kind.Video) this.emit({ type: "remote_video", track: null });
      if (track.kind === Track.Kind.Audio) this.emit({ type: "remote_audio", track: null });
    });
    room.on(RoomEvent.Reconnecting, () => this.emit({ type: "reconnecting" }));
    room.on(RoomEvent.Reconnected, () => this.emit({ type: "reconnected" }));
    room.on(RoomEvent.Disconnected, () => this.emit({ type: "disconnected" }));
  }

  private async startServerRuntime(): Promise<StartResponse> {
    return readJson<StartResponse>(
      await fetch(`${candidateApi}/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ developmentPreview: this.developmentPreview }),
      }),
    );
  }

  async connect(input: { stream: MediaStream; audioOnly: boolean }): Promise<CandidateRuntimeSnapshot> {
    const started = await this.startServerRuntime();
    await this.room?.disconnect().catch(() => undefined);

    const room = new Room({ adaptiveStream: true, dynacast: true });
    this.attachRoomEvents(room);
    await room.connect(started.connection.serverUrl, started.connection.accessToken);
    this.room = room;

    for (const track of input.stream.getAudioTracks()) {
      await room.localParticipant.publishTrack(track, {
        source: Track.Source.Microphone,
        name: "candidate-microphone",
      });
    }
    if (!input.audioOnly) {
      for (const track of input.stream.getVideoTracks()) {
        await room.localParticipant.publishTrack(track, {
          source: Track.Source.Camera,
          name: "candidate-camera",
        });
      }
    }

    const { connection: _connection, developmentPreview: _preview, ...snapshot } = started;
    void _connection;
    void _preview;
    this.snapshot = snapshot;
    this.emit({ type: "snapshot", snapshot });
    return snapshot;
  }

  async reconnect(input: { stream: MediaStream; audioOnly: boolean }): Promise<CandidateRuntimeSnapshot> {
    return this.connect(input);
  }

  async disconnect(): Promise<void> {
    const room = this.room;
    this.room = null;
    if (room) await room.disconnect();
  }

  async turnAudio(turnId: string): Promise<Blob> {
    const snapshot = this.snapshot;
    if (!snapshot) throw new Error("Candidate interview runtime is not connected");
    const response = await fetch(
      `${candidateApi}/sessions/${encodeURIComponent(snapshot.sessionId)}/media/${encodeURIComponent(snapshot.mediaSessionId)}/turns/${encodeURIComponent(turnId)}/audio`,
      { method: "POST", credentials: "same-origin" },
    );
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Interview audio failed (${response.status}): ${detail.slice(0, 300)}`);
    }
    const blob = await response.blob();
    if (!blob.type.startsWith("audio/")) throw new Error("Interview audio response was invalid");
    return blob;
  }

  async submitText(text: string): Promise<CandidateRuntimeAnswer> {
    const snapshot = this.snapshot;
    if (!snapshot) throw new Error("Candidate interview runtime is not connected");
    const result = await readJson<CandidateRuntimeAnswer>(
      await fetch(`${candidateApi}/answers/text`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          sessionId: snapshot.sessionId,
          mediaSessionId: snapshot.mediaSessionId,
          text,
        }),
      }),
    );
    this.snapshot = {
      ...snapshot,
      status: result.completed ? "completed" : "active",
      remainingSeconds: result.remainingSeconds,
      turn: result.turn,
      transcript: [
        ...snapshot.transcript,
        { speaker: "candidate", text: result.candidateText },
        { speaker: "interviewer", text: result.turn.spokenText },
      ],
    };
    this.emit({ type: "snapshot", snapshot: this.snapshot });
    return result;
  }

  async submitVoice(audio: Blob): Promise<CandidateRuntimeVoiceAnswer> {
    const snapshot = this.snapshot;
    if (!snapshot) throw new Error("Candidate interview runtime is not connected");
    const result = await readJson<CandidateRuntimeVoiceAnswer>(
      await fetch(
        `${candidateApi}/answers/audio?sessionId=${encodeURIComponent(snapshot.sessionId)}&mediaSessionId=${encodeURIComponent(snapshot.mediaSessionId)}`,
        {
          method: "POST",
          headers: { "content-type": "audio/wav" },
          credentials: "same-origin",
          body: audio,
        },
      ),
    );
    if (result.transcript?.text && result.turn && result.remainingSeconds !== undefined) {
      this.snapshot = {
        ...snapshot,
        status: result.completed ? "completed" : "active",
        remainingSeconds: result.remainingSeconds,
        turn: result.turn,
        transcript: [
          ...snapshot.transcript,
          { speaker: "candidate", text: result.transcript.text },
          { speaker: "interviewer", text: result.turn.spokenText },
        ],
      };
      this.emit({ type: "snapshot", snapshot: this.snapshot });
    }
    return result;
  }
}

export function createCandidateRealtimeRuntime(options?: { developmentPreview?: boolean }) {
  return new CandidateBrowserRealtimeRuntime(options?.developmentPreview === true);
}

"use client";

import { useEffect, useRef, useState } from "react";
import { Room, Track } from "livekit-client";

type DevelopmentContext = {
  ready: boolean;
  reason?: string;
  organizationId?: string;
  userId?: string;
  fixtures?: {
    applicationId: string;
    interviewPlanId: string;
    consentRecordId: string;
  };
};

type BrainTurn = {
  id: string;
  action: string;
  criterion: string | null;
  spokenText: string;
  brainVersion: string;
  remainingSeconds: number;
};

type MediaSession = { id: string; roomReference: string };
type ConnectionCredential = {
  serverUrl: string;
  accessToken: string;
  roomReference: string;
};

type CandidateAudioResult = {
  speechDetected: boolean;
  durationSeconds: number;
  segments: Array<{ startSeconds: number; endSeconds: number }>;
  transcript: null | {
    text: string;
    language: string;
    provider: string;
    requestId: string;
  };
};

type Message = {
  id: string;
  speaker: "candidate" | "interviewer" | "system";
  text: string;
  meta?: string;
};

const apiUrl = "/api/backend";
const TARGET_SAMPLE_RATE = 16_000;

function authHeaders(context: DevelopmentContext, contentType = "application/json"): HeadersInit {
  if (!context.organizationId || !context.userId) throw new Error("Development API context is incomplete");
  return {
    "content-type": contentType,
    "x-organization-id": context.organizationId,
    "x-user-id": context.userId,
  };
}

async function readJson<T>(response: Response): Promise<T> {
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

function estimateSpeechDurationMs(text: string): number {
  return Math.min(90_000, Math.max(1_500, Math.round(text.trim().length * 55)));
}

function mergeFloat32(chunks: Float32Array[], totalLength: number): Float32Array {
  const merged = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function downsampleMono(input: Float32Array, sourceRate: number, targetRate: number): Float32Array {
  if (sourceRate === targetRate) return input;
  if (sourceRate < targetRate) throw new Error(`Microphone sample rate ${sourceRate} Hz is below ${targetRate} Hz`);
  const ratio = sourceRate / targetRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);
  for (let index = 0; index < outputLength; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(input.length, Math.max(start + 1, Math.floor((index + 1) * ratio)));
    let sum = 0;
    for (let sourceIndex = start; sourceIndex < end; sourceIndex += 1) sum += input[sourceIndex] ?? 0;
    output[index] = sum / Math.max(1, end - start);
  }
  return output;
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}

function encodePcm16Wav(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, samples.length * bytesPerSample, true);
  let offset = 44;
  for (const sample of samples) {
    const clipped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff, true);
    offset += bytesPerSample;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export function InternalRealtimeInterviewHarness() {
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [connected, setConnected] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [status, setStatus] = useState("Realtime microphone interview has not been started.");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [mediaSessionId, setMediaSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const contextRef = useRef<DevelopmentContext | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const mediaSessionIdRef = useRef<string | null>(null);
  const elapsedMsRef = useRef(0);
  const roomRef = useRef<Room | null>(null);
  const micTrackRef = useRef<MediaStreamTrack | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const muteGainRef = useRef<GainNode | null>(null);
  const recordingRef = useRef(false);
  const sampleChunksRef = useRef<Float32Array[]>([]);
  const sampleCountRef = useRef(0);
  const audioUrlRef = useRef<string | null>(null);

  async function appendMediaEvent(eventType: string, sourceComponent: string, payload: Record<string, unknown> = {}) {
    const context = contextRef.current;
    const activeSessionId = sessionIdRef.current;
    const activeMediaSessionId = mediaSessionIdRef.current;
    if (!context || !activeSessionId || !activeMediaSessionId) return;
    await readJson(
      await fetch(`${apiUrl}/v1/interviews/${activeSessionId}/media/sessions/${activeMediaSessionId}/events`, {
        method: "POST",
        headers: authHeaders(context),
        body: JSON.stringify({
          idempotencyKey: `realtime-harness:${eventType}:${crypto.randomUUID()}`,
          eventType,
          sourceComponent,
          payload,
        }),
      }),
    );
  }

  async function appendTranscript(
    context: DevelopmentContext,
    activeSessionId: string,
    speaker: "candidate" | "interviewer",
    text: string,
    startMs: number,
    durationMs: number,
  ) {
    return readJson<{ id: string; endMs: number }>(
      await fetch(`${apiUrl}/v1/interviews/${activeSessionId}/transcript-segments`, {
        method: "POST",
        headers: authHeaders(context),
        body: JSON.stringify({ speaker, startMs, endMs: startMs + durationMs, text, isFinal: true }),
      }),
    );
  }

  async function requestBrainTurn(context: DevelopmentContext, activeSessionId: string, input: Record<string, unknown>) {
    return readJson<BrainTurn>(
      await fetch(`${apiUrl}/v1/interviews/${activeSessionId}/brain/next-turn`, {
        method: "POST",
        headers: authHeaders(context),
        body: JSON.stringify(input),
      }),
    );
  }

  async function playTurnAudio(context: DevelopmentContext, activeSessionId: string, activeMediaSessionId: string, turn: BrainTurn) {
    const response = await fetch(
      `${apiUrl}/v1/interviews/${activeSessionId}/media/sessions/${activeMediaSessionId}/turns/${turn.id}/audio`,
      { method: "POST", headers: authHeaders(context) },
    );
    if (!response.ok) throw new Error(`TTS playback failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
    const blob = await response.blob();
    const nextUrl = URL.createObjectURL(blob);
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = nextUrl;
    setAudioUrl(nextUrl);
    const audio = new Audio(nextUrl);
    try {
      await audio.play();
      setStatus(turn.action === "close" ? "Interview completed." : "Question played. Click Start answer and speak naturally.");
    } catch {
      setStatus(turn.action === "close" ? "Interview completed. Use the audio control to hear the closing turn." : "Use the audio control to hear the question, then click Start answer.");
    }
  }

  function installAudioCapture(track: MediaStreamTrack): void {
    const AudioContextClass = window.AudioContext;
    const context = new AudioContextClass();
    const stream = new MediaStream([track]);
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const muteGain = context.createGain();
    muteGain.gain.value = 0;
    processor.onaudioprocess = (event) => {
      event.outputBuffer.getChannelData(0).fill(0);
      if (!recordingRef.current) return;
      const input = event.inputBuffer.getChannelData(0);
      const copy = new Float32Array(input.length);
      copy.set(input);
      sampleChunksRef.current.push(copy);
      sampleCountRef.current += copy.length;
    };
    source.connect(processor);
    processor.connect(muteGain);
    muteGain.connect(context.destination);
    audioContextRef.current = context;
    sourceRef.current = source;
    processorRef.current = processor;
    muteGainRef.current = muteGain;
  }

  async function startInterview() {
    setBusy(true);
    setCompleted(false);
    setStatus("Creating persisted interview session and connecting LiveKit microphone…");
    try {
      const context = await readJson<DevelopmentContext>(
        await fetch(`${apiUrl}/development/context`, { cache: "no-store" }),
      );
      if (!context.ready || !context.fixtures || !context.organizationId || !context.userId) {
        throw new Error(context.reason ?? "Development fixtures are not ready");
      }
      contextRef.current = context;

      const session = await readJson<{ id: string }>(
        await fetch(`${apiUrl}/v1/interviews/sessions`, {
          method: "POST",
          headers: authHeaders(context),
          body: JSON.stringify({
            applicationId: context.fixtures.applicationId,
            interviewPlanId: context.fixtures.interviewPlanId,
            consentRecordId: context.fixtures.consentRecordId,
            candidateIsRealCustomerCandidate: false,
            synchronousHumanSupervisorPresent: false,
          }),
        }),
      );
      sessionIdRef.current = session.id;
      setSessionId(session.id);

      await readJson(
        await fetch(`${apiUrl}/v1/interviews/${session.id}/state/transitions`, {
          method: "POST",
          headers: authHeaders(context),
          body: JSON.stringify({ idempotencyKey: `realtime-harness-start-${session.id}`, action: "start" }),
        }),
      );
      await readJson<{ ready: true }>(
        await fetch(`${apiUrl}/v1/interviews/${session.id}/media/preflight`, {
          method: "POST",
          headers: authHeaders(context),
          body: JSON.stringify({ mode: "audio" }),
        }),
      );
      const mediaSession = await readJson<MediaSession>(
        await fetch(`${apiUrl}/v1/interviews/${session.id}/media/sessions`, {
          method: "POST",
          headers: authHeaders(context),
          body: JSON.stringify({ mode: "audio" }),
        }),
      );
      mediaSessionIdRef.current = mediaSession.id;
      setMediaSessionId(mediaSession.id);

      const credential = await readJson<ConnectionCredential>(
        await fetch(`${apiUrl}/v1/interviews/${session.id}/media/sessions/${mediaSession.id}/connection`, {
          method: "POST",
          headers: authHeaders(context),
        }),
      );
      const room = new Room({ adaptiveStream: true, dynacast: true });
      await room.connect(credential.serverUrl, credential.accessToken);
      roomRef.current = room;

      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      const micTrack = micStream.getAudioTracks()[0];
      if (!micTrack) throw new Error("Browser did not provide a microphone audio track");
      micTrackRef.current = micTrack;
      await room.localParticipant.publishTrack(micTrack, { source: Track.Source.Microphone, name: "candidate-microphone" });
      installAudioCapture(micTrack);
      setConnected(true);
      await appendMediaEvent("connected", "transport", { transport: "livekit", roomReference: credential.roomReference });

      const firstTurn = await requestBrainTurn(context, session.id, { elapsedSeconds: 0 });
      const firstDurationMs = estimateSpeechDurationMs(firstTurn.spokenText);
      await appendTranscript(context, session.id, "interviewer", firstTurn.spokenText, 0, firstDurationMs);
      elapsedMsRef.current = firstDurationMs;
      setMessages([
        { id: `system-${session.id}`, speaker: "system", text: "Realtime synthetic session connected: LiveKit + microphone + VAD/STT bridge + persisted Brain + local TTS." },
        { id: firstTurn.id, speaker: "interviewer", text: firstTurn.spokenText, meta: `${firstTurn.action} · ${firstTurn.criterion ?? "session"} · ${firstTurn.brainVersion}` },
      ]);
      setCompleted(firstTurn.action === "close");
      await playTurnAudio(context, session.id, mediaSession.id, firstTurn);
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "Could not start realtime interview harness");
    } finally {
      setBusy(false);
    }
  }

  function startAnswer() {
    if (!connected || completed || processing || recording) return;
    sampleChunksRef.current = [];
    sampleCountRef.current = 0;
    recordingRef.current = true;
    setRecording(true);
    setStatus("Listening… speak your answer, then click Stop answer.");
  }

  async function stopAnswer() {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    setRecording(false);
    setProcessing(true);
    setStatus("Running Silero VAD → whisper.cpp → persisted transcript → Brain → TTS…");
    try {
      const context = contextRef.current;
      const activeSessionId = sessionIdRef.current;
      const activeMediaSessionId = mediaSessionIdRef.current;
      const audioContext = audioContextRef.current;
      if (!context || !activeSessionId || !activeMediaSessionId || !audioContext) {
        throw new Error("Realtime interview runtime is incomplete");
      }
      const samples = mergeFloat32(sampleChunksRef.current, sampleCountRef.current);
      if (samples.length < audioContext.sampleRate / 4) throw new Error("Recorded answer is too short. Speak for at least a moment.");
      const normalized = downsampleMono(samples, audioContext.sampleRate, TARGET_SAMPLE_RATE);
      const wav = encodePcm16Wav(normalized, TARGET_SAMPLE_RATE);

      const speech = await readJson<CandidateAudioResult>(
        await fetch(`${apiUrl}/v1/interviews/${activeSessionId}/media/sessions/${activeMediaSessionId}/candidate-audio`, {
          method: "POST",
          headers: authHeaders(context, "audio/wav"),
          body: wav,
        }),
      );
      if (!speech.speechDetected) {
        setStatus("Silero VAD did not detect speech. Click Start answer and try again.");
        return;
      }
      const candidateText = speech.transcript?.text.trim() ?? "";
      if (!candidateText) {
        setStatus("Whisper returned an empty transcript. Click Start answer and try again.");
        return;
      }

      const candidateStartMs = elapsedMsRef.current;
      const candidateDurationMs = Math.max(250, Math.round(speech.durationSeconds * 1000));
      await appendTranscript(context, activeSessionId, "candidate", candidateText, candidateStartMs, candidateDurationMs);
      elapsedMsRef.current += candidateDurationMs;
      setMessages((current) => [
        ...current,
        { id: `candidate-${crypto.randomUUID()}`, speaker: "candidate", text: candidateText, meta: `${speech.transcript?.provider ?? "stt"} · ${speech.transcript?.language ?? "unknown"}` },
      ]);

      const nextTurn = await requestBrainTurn(context, activeSessionId, {
        latestCandidateText: candidateText,
        candidateIntent: "ANSWER",
        elapsedSeconds: Math.max(1, Math.round(speech.durationSeconds)),
      });
      const interviewerDurationMs = estimateSpeechDurationMs(nextTurn.spokenText);
      await appendTranscript(context, activeSessionId, "interviewer", nextTurn.spokenText, elapsedMsRef.current, interviewerDurationMs);
      elapsedMsRef.current += interviewerDurationMs;
      await appendMediaEvent("brain_turn", "brain", { turnId: nextTurn.id, action: nextTurn.action, criterion: nextTurn.criterion });
      setMessages((current) => [
        ...current,
        { id: nextTurn.id, speaker: "interviewer", text: nextTurn.spokenText, meta: `${nextTurn.action} · ${nextTurn.criterion ?? "session"} · ${nextTurn.brainVersion}` },
      ]);
      setCompleted(nextTurn.action === "close");
      await playTurnAudio(context, activeSessionId, activeMediaSessionId, nextTurn);
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "Candidate realtime turn failed");
    } finally {
      setProcessing(false);
      sampleChunksRef.current = [];
      sampleCountRef.current = 0;
    }
  }

  useEffect(() => {
    return () => {
      recordingRef.current = false;
      processorRef.current?.disconnect();
      sourceRef.current?.disconnect();
      muteGainRef.current?.disconnect();
      void audioContextRef.current?.close();
      micTrackRef.current?.stop();
      void roomRef.current?.disconnect();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    };
  }, []);

  return (
    <section className="rounded-[14px] border border-indigo-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[.12em] text-indigo-600">M4 · realtime end-to-end harness</div>
          <div className="mt-1 text-[15px] font-semibold text-slate-900">Microphone → LiveKit → Silero VAD → Whisper → Brain → Piper</div>
          <p className="mt-1 max-w-3xl text-[10px] leading-5 text-slate-500">Synthetic development candidate only. The microphone track is published to LiveKit and sampled in-memory for the DEV_ONLY VAD/STT bridge. Raw audio is never persisted by the API.</p>
        </div>
        <span className={`rounded-full px-3 py-1.5 text-[9px] font-semibold ${connected ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{connected ? "connected" : "idle"}</span>
      </div>

      <div className="mt-4 rounded-[10px] bg-slate-50 p-3 text-[10px] leading-5 text-slate-700">{status}</div>
      {sessionId ? <div className="mt-2 text-[9px] text-slate-400">session <span className="font-mono">{sessionId}</span>{mediaSessionId ? <> · media <span className="font-mono">{mediaSessionId}</span></> : null}</div> : null}

      {!sessionId ? (
        <button type="button" onClick={() => void startInterview()} disabled={busy} className="mt-4 h-10 rounded-[10px] bg-indigo-600 px-4 text-[11px] font-semibold text-white disabled:bg-slate-300">{busy ? "Starting realtime interview…" : "Start realtime interview"}</button>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={startAnswer} disabled={!connected || completed || processing || recording} className="h-10 rounded-[10px] bg-emerald-600 px-4 text-[11px] font-semibold text-white disabled:bg-slate-300">{recording ? "Listening…" : "Start answer"}</button>
          <button type="button" onClick={() => void stopAnswer()} disabled={!recording} className="h-10 rounded-[10px] bg-rose-600 px-4 text-[11px] font-semibold text-white disabled:bg-slate-300">Stop answer</button>
        </div>
      )}

      {audioUrl ? <audio className="mt-4 w-full" controls src={audioUrl} /> : null}

      {messages.length > 0 ? (
        <div className="mt-4 max-h-[420px] space-y-2 overflow-y-auto rounded-[12px] border border-slate-100 bg-slate-50 p-3">
          {messages.map((message) => (
            <div key={message.id} className={`rounded-[10px] border p-3 ${message.speaker === "candidate" ? "ms-auto max-w-[88%] border-indigo-100 bg-indigo-50" : message.speaker === "interviewer" ? "max-w-[88%] border-slate-200 bg-white" : "border-amber-100 bg-amber-50"}`}>
              <div className="text-[9px] font-semibold uppercase tracking-[.1em] text-slate-400">{message.speaker}</div>
              <div className="mt-1 text-[11px] leading-5 text-slate-700">{message.text}</div>
              {message.meta ? <div className="mt-2 text-[9px] text-slate-400">{message.meta}</div> : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

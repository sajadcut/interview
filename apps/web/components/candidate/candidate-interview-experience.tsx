"use client";

import { useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";
import { getDefaultLocale } from "../../lib/i18n";

const apiUrl = "/api/backend/v1/candidate-interview";
const TARGET_SAMPLE_RATE = 16_000;
const SILENCE_TO_SUBMIT_MS = 1_400;
const MAX_VOICE_ANSWER_MS = 90_000;

type InterviewMessage = {
  id: string;
  speaker: "interviewer" | "candidate";
  text: string;
};

type InterviewTurn = {
  id: string;
  action: string;
  criterion: string | null;
  spokenText: string;
};

type StartResponse = {
  status: "active" | "completed";
  sessionId: string;
  mediaSessionId: string;
  remainingSeconds: number;
  developmentPreview: boolean;
  releaseMode: string;
  interviewer: {
    name: string;
    subtitle: string;
    avatarVideoAvailable: boolean;
  };
  turn: InterviewTurn;
  transcript: Array<{ speaker: "candidate" | "interviewer"; text: string }>;
  connection: {
    transport: "livekit";
    serverUrl: string;
    roomReference: string;
    accessToken: string;
    expiresAt: string;
  };
  privacy: {
    rawMediaPersisted: false;
    candidateVideoAnalysis: "none";
    biometricInferenceAllowed: false;
  };
};

type AnswerResponse = {
  candidateText: string;
  remainingSeconds: number;
  completed: boolean;
  turn: InterviewTurn;
};

type AudioAnswerResponse = Partial<AnswerResponse> & {
  speechDetected: boolean;
  durationSeconds: number;
  transcript: null | { text: string; language: string; provider: string };
};

export interface CandidateInterviewExperienceProps {
  candidateName: string;
  jobTitle: string;
  sessionExpiresAt: string;
  developmentPreview?: boolean;
}

function ui(locale: string) {
  const fa = locale.toLowerCase().startsWith("fa");
  return fa
    ? {
        title: "اتاق مصاحبه",
        secure: "جلسه امن کاندیدا",
        hello: "سلام",
        role: "موقعیت",
        prejoin: "قبل از شروع، تصویر و صدای خود را بررسی کنید.",
        enableDevices: "فعال‌سازی دوربین و میکروفون",
        start: "شروع مصاحبه",
        starting: "در حال ورود به مصاحبه…",
        interviewer: "مصاحبه‌گر هوشمند",
        waitingVideo: "ویدیوی مصاحبه‌گر هنوز فعال نیست",
        audioOnlyInterviewer: "در حال حاضر مصاحبه‌گر با صدا فعال است. اگر آواتار ویدیویی به LiveKit متصل شود، تصویر اینجا نمایش داده می‌شود.",
        you: "شما",
        micOn: "میکروفون روشن",
        micOff: "میکروفون خاموش",
        cameraOn: "دوربین روشن",
        cameraOff: "دوربین خاموش",
        speakerOn: "صدا روشن",
        speakerOff: "صدا خاموش",
        voice: "پاسخ صوتی",
        listening: "در حال شنیدن…",
        listeningHelp: "طبیعی صحبت کنید؛ پس از مکث کوتاه پاسخ خودکار ارسال می‌شود.",
        processing: "در حال پردازش پاسخ…",
        typePlaceholder: "اگر ترجیح می‌دهید، پاسخ خود را اینجا تایپ کنید…",
        send: "ارسال پاسخ متنی",
        sending: "در حال ارسال…",
        yourTurn: "نوبت شماست؛ می‌توانید صحبت کنید یا پاسخ را تایپ کنید.",
        interviewerSpeaking: "مصاحبه‌گر در حال صحبت است…",
        connected: "متصل",
        ready: "آماده شروع",
        completed: "مصاحبه تکمیل شد",
        privacy: "صوت و ویدیوی خام در دیتابیس API ذخیره نمی‌شود. فقط متن نهایی لازم برای مصاحبه و ارزیابی نگهداری می‌شود.",
        preview: "پیش‌نمایش توسعه",
        expires: "اعتبار نشست",
        transcript: "گفت‌وگو",
        permissionError: "برای مصاحبه دسترسی میکروفون و دوربین لازم است.",
        genericError: "اجرای مصاحبه با خطا روبه‌رو شد.",
        noSpeech: "صدایی تشخیص داده نشد. دوباره پاسخ صوتی را بزنید و صحبت کنید.",
        emptySpeech: "گفتار تشخیص داده شد اما متن قابل استفاده‌ای تولید نشد. دوباره تلاش کنید.",
      }
    : {
        title: "Interview room",
        secure: "Secure candidate session",
        hello: "Hello",
        role: "Role",
        prejoin: "Check your camera and microphone before starting.",
        enableDevices: "Enable camera & microphone",
        start: "Start interview",
        starting: "Joining interview…",
        interviewer: "AI Interviewer",
        waitingVideo: "Interviewer video is not active yet",
        audioOnlyInterviewer: "The interviewer is currently audio-first. If a video avatar joins LiveKit, it will appear here.",
        you: "You",
        micOn: "Microphone on",
        micOff: "Microphone off",
        cameraOn: "Camera on",
        cameraOff: "Camera off",
        speakerOn: "Speaker on",
        speakerOff: "Speaker off",
        voice: "Answer by voice",
        listening: "Listening…",
        listeningHelp: "Speak naturally; your answer submits automatically after a short pause.",
        processing: "Processing answer…",
        typePlaceholder: "Or type your answer here…",
        send: "Send typed answer",
        sending: "Sending…",
        yourTurn: "Your turn. Speak or type your answer.",
        interviewerSpeaking: "Interviewer is speaking…",
        connected: "Connected",
        ready: "Ready to start",
        completed: "Interview completed",
        privacy: "Raw audio/video is not persisted in the API database. Only finalized text required for the interview and evaluation is retained.",
        preview: "Development preview",
        expires: "Session valid until",
        transcript: "Conversation",
        permissionError: "Camera and microphone access are required for the interview.",
        genericError: "The interview runtime encountered an error.",
        noSpeech: "No speech was detected. Try the voice answer again and speak naturally.",
        emptySpeech: "Speech was detected but no usable transcript was produced. Please try again.",
      };
}

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
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function formatExpiry(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
  } catch {
    return date.toISOString();
  }
}

export function CandidateInterviewExperience({
  candidateName,
  jobTitle,
  sessionExpiresAt,
  developmentPreview = false,
}: CandidateInterviewExperienceProps) {
  const locale = getDefaultLocale();
  const copy = ui(locale);
  const rtl = locale.toLowerCase().startsWith("fa");
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [runtime, setRuntime] = useState<StartResponse | null>(null);
  const [messages, setMessages] = useState<InterviewMessage[]>([]);
  const [typedAnswer, setTypedAnswer] = useState("");
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [listening, setListening] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [speakerEnabled, setSpeakerEnabled] = useState(true);
  const [remoteVideoActive, setRemoteVideoActive] = useState(false);
  const [status, setStatus] = useState(copy.prejoin);
  const [error, setError] = useState<string | null>(null);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const roomRef = useRef<Room | null>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsUrlRef = useRef<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const sampleCountRef = useRef(0);
  const listeningRef = useRef(false);
  const voiceStartRef = useRef(0);
  const speechSeenRef = useRef(false);
  const lastSpeechRef = useRef(0);
  const maxVoiceTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (localVideoRef.current) localVideoRef.current.srcObject = localStream;
  }, [localStream]);

  useEffect(() => {
    if (remoteAudioRef.current) remoteAudioRef.current.muted = !speakerEnabled;
    if (remoteVideoRef.current) remoteVideoRef.current.muted = !speakerEnabled;
    if (ttsAudioRef.current) ttsAudioRef.current.muted = !speakerEnabled;
  }, [speakerEnabled]);

  async function enableDevices() {
    setDeviceBusy(true);
    setError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error(copy.permissionError);
      localStream?.getTracks().forEach((track) => track.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
      });
      if (!stream.getAudioTracks().length || !stream.getVideoTracks().length) throw new Error(copy.permissionError);
      setLocalStream(stream);
      setMicrophoneEnabled(true);
      setCameraEnabled(true);
      setStatus(copy.ready);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.permissionError);
    } finally {
      setDeviceBusy(false);
    }
  }

  function attachRemoteTracks(room: Room) {
    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === Track.Kind.Video && remoteVideoRef.current) {
        track.attach(remoteVideoRef.current);
        setRemoteVideoActive(true);
      }
      if (track.kind === Track.Kind.Audio && remoteAudioRef.current) {
        track.attach(remoteAudioRef.current);
        remoteAudioRef.current.muted = !speakerEnabled;
        void remoteAudioRef.current.play().catch(() => undefined);
      }
    });
    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      track.detach();
      if (track.kind === Track.Kind.Video) setRemoteVideoActive(false);
    });
    room.on(RoomEvent.Disconnected, () => {
      if (!completed) setStatus(rtl ? "اتصال مصاحبه قطع شد. صفحه را باز نگه دارید تا دوباره متصل شوید." : "Interview connection was lost. Keep this page open while reconnecting.");
    });
  }

  async function connectLiveKit(started: StartResponse, stream: MediaStream) {
    const room = new Room({ adaptiveStream: true, dynacast: true });
    attachRemoteTracks(room);
    await room.connect(started.connection.serverUrl, started.connection.accessToken);
    roomRef.current = room;
    for (const track of stream.getAudioTracks()) {
      await room.localParticipant.publishTrack(track, {
        source: Track.Source.Microphone,
        name: "candidate-microphone",
      });
    }
    for (const track of stream.getVideoTracks()) {
      await room.localParticipant.publishTrack(track, {
        source: Track.Source.Camera,
        name: "candidate-camera",
      });
    }
  }

  async function playTurn(turn: InterviewTurn, activeRuntime = runtime) {
    if (!activeRuntime) return;
    setStatus(copy.interviewerSpeaking);
    const response = await fetch(
      `${apiUrl}/sessions/${activeRuntime.sessionId}/media/${activeRuntime.mediaSessionId}/turns/${turn.id}/audio`,
      { method: "POST", credentials: "same-origin" },
    );
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`TTS ${response.status}: ${detail.slice(0, 240)}`);
    }
    const blob = await response.blob();
    if (ttsUrlRef.current) URL.revokeObjectURL(ttsUrlRef.current);
    const url = URL.createObjectURL(blob);
    ttsUrlRef.current = url;
    const audio = new Audio(url);
    audio.muted = !speakerEnabled;
    ttsAudioRef.current = audio;
    try {
      await audio.play();
      await new Promise<void>((resolve) => {
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
      });
    } catch {
      // Browser autoplay policy can block playback. The candidate can enable speaker and retry via the next interaction.
    }
    if (turn.action === "close") {
      setCompleted(true);
      setStatus(copy.completed);
    } else {
      setStatus(copy.yourTurn);
    }
  }

  async function startInterview() {
    if (!localStream) return;
    setStarting(true);
    setError(null);
    setStatus(copy.starting);
    try {
      const started = await readJson<StartResponse>(
        await fetch(`${apiUrl}/start`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ developmentPreview }),
        }),
      );
      await connectLiveKit(started, localStream);
      setRuntime(started);
      setCompleted(started.status === "completed");
      setMessages(
        started.transcript.map((item, index) => ({
          id: `history-${index}`,
          speaker: item.speaker,
          text: item.text,
        })),
      );
      await playTurn(started.turn, started);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.genericError);
      setStatus(copy.prejoin);
    } finally {
      setStarting(false);
    }
  }

  function stopCaptureNodes() {
    if (maxVoiceTimerRef.current !== null) window.clearTimeout(maxVoiceTimerRef.current);
    maxVoiceTimerRef.current = null;
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    gainRef.current?.disconnect();
    processorRef.current = null;
    sourceRef.current = null;
    gainRef.current = null;
  }

  async function finishVoiceAnswer() {
    if (!listeningRef.current) return;
    listeningRef.current = false;
    setListening(false);
    stopCaptureNodes();
    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (!context) return;
    const sourceRate = context.sampleRate;
    await context.close().catch(() => undefined);

    if (!speechSeenRef.current || sampleCountRef.current < sourceRate / 4) {
      chunksRef.current = [];
      sampleCountRef.current = 0;
      setStatus(copy.noSpeech);
      return;
    }

    setProcessing(true);
    setStatus(copy.processing);
    try {
      if (!runtime) throw new Error(copy.genericError);
      const merged = mergeFloat32(chunksRef.current, sampleCountRef.current);
      const normalized = downsampleMono(merged, sourceRate, TARGET_SAMPLE_RATE);
      const wav = encodePcm16Wav(normalized, TARGET_SAMPLE_RATE);
      const result = await readJson<AudioAnswerResponse>(
        await fetch(
          `${apiUrl}/answers/audio?sessionId=${encodeURIComponent(runtime.sessionId)}&mediaSessionId=${encodeURIComponent(runtime.mediaSessionId)}`,
          {
            method: "POST",
            headers: { "content-type": "audio/wav" },
            credentials: "same-origin",
            body: wav,
          },
        ),
      );
      if (!result.speechDetected) {
        setStatus(copy.noSpeech);
        return;
      }
      if (!result.transcript?.text || !result.turn) {
        setStatus(copy.emptySpeech);
        return;
      }
      setMessages((current) => [
        ...current,
        { id: `candidate-${crypto.randomUUID()}`, speaker: "candidate", text: result.transcript!.text },
        { id: result.turn!.id, speaker: "interviewer", text: result.turn!.spokenText },
      ]);
      setRuntime((current) => current ? { ...current, remainingSeconds: result.remainingSeconds ?? current.remainingSeconds, turn: result.turn! } : current);
      await playTurn(result.turn);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.genericError);
      setStatus(copy.yourTurn);
    } finally {
      chunksRef.current = [];
      sampleCountRef.current = 0;
      setProcessing(false);
    }
  }

  async function startVoiceAnswer() {
    if (!runtime || !localStream || processing || completed || listening || !microphoneEnabled) return;
    const micTrack = localStream.getAudioTracks().find((track) => track.readyState === "live");
    if (!micTrack) {
      setError(copy.permissionError);
      return;
    }
    setError(null);
    chunksRef.current = [];
    sampleCountRef.current = 0;
    speechSeenRef.current = false;
    voiceStartRef.current = performance.now();
    lastSpeechRef.current = voiceStartRef.current;
    const context = new AudioContext();
    await context.resume();
    const source = context.createMediaStreamSource(new MediaStream([micTrack]));
    const processor = context.createScriptProcessor(4096, 1, 1);
    const gain = context.createGain();
    gain.gain.value = 0;
    processor.onaudioprocess = (event) => {
      event.outputBuffer.getChannelData(0).fill(0);
      if (!listeningRef.current) return;
      const input = event.inputBuffer.getChannelData(0);
      const copySamples = new Float32Array(input.length);
      copySamples.set(input);
      chunksRef.current.push(copySamples);
      sampleCountRef.current += copySamples.length;
      let energy = 0;
      for (const sample of input) energy += sample * sample;
      const rms = Math.sqrt(energy / Math.max(1, input.length));
      const now = performance.now();
      if (rms >= 0.018) {
        speechSeenRef.current = true;
        lastSpeechRef.current = now;
      }
      if (speechSeenRef.current && now - lastSpeechRef.current >= SILENCE_TO_SUBMIT_MS && now - voiceStartRef.current >= 1_000) {
        listeningRef.current = false;
        queueMicrotask(() => {
          listeningRef.current = true;
          void finishVoiceAnswer();
        });
      }
    };
    source.connect(processor);
    processor.connect(gain);
    gain.connect(context.destination);
    audioContextRef.current = context;
    sourceRef.current = source;
    processorRef.current = processor;
    gainRef.current = gain;
    listeningRef.current = true;
    setListening(true);
    setStatus(copy.listeningHelp);
    maxVoiceTimerRef.current = window.setTimeout(() => void finishVoiceAnswer(), MAX_VOICE_ANSWER_MS);
  }

  async function sendTypedAnswer() {
    const text = typedAnswer.trim();
    if (!runtime || !text || processing || completed) return;
    setProcessing(true);
    setError(null);
    setStatus(copy.processing);
    try {
      const result = await readJson<AnswerResponse>(
        await fetch(`${apiUrl}/answers/text`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            sessionId: runtime.sessionId,
            mediaSessionId: runtime.mediaSessionId,
            text,
          }),
        }),
      );
      setTypedAnswer("");
      setMessages((current) => [
        ...current,
        { id: `candidate-${crypto.randomUUID()}`, speaker: "candidate", text },
        { id: result.turn.id, speaker: "interviewer", text: result.turn.spokenText },
      ]);
      setRuntime((current) => current ? { ...current, remainingSeconds: result.remainingSeconds, turn: result.turn } : current);
      await playTurn(result.turn);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.genericError);
      setStatus(copy.yourTurn);
    } finally {
      setProcessing(false);
    }
  }

  function toggleMicrophone() {
    const next = !microphoneEnabled;
    localStream?.getAudioTracks().forEach((track) => { track.enabled = next; });
    setMicrophoneEnabled(next);
  }

  function toggleCamera() {
    const next = !cameraEnabled;
    localStream?.getVideoTracks().forEach((track) => { track.enabled = next; });
    setCameraEnabled(next);
  }

  useEffect(() => {
    return () => {
      listeningRef.current = false;
      stopCaptureNodes();
      void audioContextRef.current?.close();
      localStream?.getTracks().forEach((track) => track.stop());
      void roomRef.current?.disconnect();
      if (ttsUrlRef.current) URL.revokeObjectURL(ttsUrlRef.current);
    };
  }, [localStream]);

  const active = Boolean(runtime) && !completed;

  return (
    <main dir={rtl ? "rtl" : "ltr"} className="min-h-screen bg-slate-950 p-3 text-slate-100 sm:p-5">
      <div className="mx-auto max-w-7xl space-y-3">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 shadow-xl">
          <div>
            <div className="text-sm font-semibold">{copy.title}</div>
            <div className="mt-1 text-[11px] text-slate-400">{copy.hello} {candidateName} · {copy.role}: {jobTitle}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[10px]">
            {developmentPreview ? <span className="rounded-full bg-amber-400/10 px-3 py-1.5 font-semibold text-amber-300">{copy.preview}</span> : null}
            <span className={`rounded-full px-3 py-1.5 font-semibold ${runtime ? "bg-emerald-400/10 text-emerald-300" : "bg-slate-800 text-slate-300"}`}>{runtime ? copy.connected : copy.ready}</span>
            <span className="rounded-full bg-slate-800 px-3 py-1.5 text-slate-400">{copy.expires}: {formatExpiry(sessionExpiresAt, locale)}</span>
          </div>
        </header>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl">
            <div className="relative aspect-video min-h-[360px]">
              <video ref={remoteVideoRef} autoPlay playsInline className={`h-full w-full object-cover ${remoteVideoActive ? "" : "hidden"}`} />
              <audio ref={remoteAudioRef} autoPlay />
              {!remoteVideoActive ? (
                <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-slate-900 via-slate-950 to-indigo-950 p-8 text-center">
                  <div className="max-w-md">
                    <div className="mx-auto grid h-24 w-24 place-items-center rounded-full border border-white/10 bg-white/5 text-4xl">✦</div>
                    <h2 className="mt-5 text-xl font-semibold">{runtime?.interviewer.name ?? copy.interviewer}</h2>
                    <p className="mt-2 text-sm leading-6 text-slate-400">{runtime ? copy.audioOnlyInterviewer : copy.waitingVideo}</p>
                  </div>
                </div>
              ) : null}

              <div className="absolute start-4 top-4 rounded-full bg-black/50 px-3 py-1.5 text-[11px] font-semibold backdrop-blur">{runtime?.interviewer.name ?? copy.interviewer}</div>
              <div className="absolute bottom-4 end-4 h-36 w-48 overflow-hidden rounded-xl border border-white/20 bg-slate-900 shadow-2xl sm:h-40 sm:w-56">
                <video ref={localVideoRef} autoPlay muted playsInline className={`h-full w-full object-cover ${cameraEnabled && localStream ? "" : "hidden"}`} />
                {!cameraEnabled || !localStream ? <div className="grid h-full place-items-center text-xs text-slate-400">{copy.cameraOff}</div> : null}
                <div className="absolute bottom-2 start-2 rounded bg-black/50 px-2 py-1 text-[10px]">{copy.you}</div>
              </div>
            </div>

            <div className="border-t border-white/10 bg-slate-900/90 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div aria-live="polite" className="text-sm font-medium text-slate-100">{completed ? copy.completed : processing ? copy.processing : listening ? copy.listening : status}</div>
                  {listening ? <div className="mt-1 text-[11px] text-emerald-300">{copy.listeningHelp}</div> : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={toggleMicrophone} disabled={!localStream} className={`rounded-xl px-3 py-2 text-xs font-semibold ${microphoneEnabled ? "bg-slate-800 text-white" : "bg-rose-500/20 text-rose-200"}`}>{microphoneEnabled ? copy.micOn : copy.micOff}</button>
                  <button type="button" onClick={toggleCamera} disabled={!localStream} className={`rounded-xl px-3 py-2 text-xs font-semibold ${cameraEnabled ? "bg-slate-800 text-white" : "bg-rose-500/20 text-rose-200"}`}>{cameraEnabled ? copy.cameraOn : copy.cameraOff}</button>
                  <button type="button" onClick={() => setSpeakerEnabled((value) => !value)} className={`rounded-xl px-3 py-2 text-xs font-semibold ${speakerEnabled ? "bg-slate-800 text-white" : "bg-rose-500/20 text-rose-200"}`}>{speakerEnabled ? copy.speakerOn : copy.speakerOff}</button>
                </div>
              </div>

              {!runtime ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" onClick={() => void enableDevices()} disabled={deviceBusy || starting} className="rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-xs font-semibold hover:bg-white/10 disabled:opacity-40">{deviceBusy ? "…" : copy.enableDevices}</button>
                  <button type="button" onClick={() => void startInterview()} disabled={!localStream || starting || deviceBusy} className="rounded-xl bg-indigo-500 px-5 py-2.5 text-xs font-semibold text-white hover:bg-indigo-400 disabled:bg-slate-700 disabled:text-slate-400">{starting ? copy.starting : copy.start}</button>
                </div>
              ) : null}

              {active ? (
                <div className="mt-4 grid gap-3 lg:grid-cols-[auto_1fr_auto] lg:items-end">
                  <button type="button" onClick={() => void startVoiceAnswer()} disabled={processing || listening || !microphoneEnabled} className="min-h-12 rounded-xl bg-emerald-500 px-5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:bg-slate-700 disabled:text-slate-400">{listening ? copy.listening : copy.voice}</button>
                  <label className="block">
                    <span className="sr-only">{copy.typePlaceholder}</span>
                    <textarea value={typedAnswer} onChange={(event) => setTypedAnswer(event.target.value)} disabled={processing || listening} rows={2} placeholder={copy.typePlaceholder} className="min-h-12 w-full resize-y rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-600 focus:border-indigo-400 disabled:opacity-50" />
                  </label>
                  <button type="button" onClick={() => void sendTypedAnswer()} disabled={!typedAnswer.trim() || processing || listening} className="min-h-12 rounded-xl bg-indigo-500 px-5 text-sm font-semibold text-white hover:bg-indigo-400 disabled:bg-slate-700 disabled:text-slate-400">{processing ? copy.sending : copy.send}</button>
                </div>
              ) : null}

              {error ? <div role="alert" className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-xs leading-5 text-rose-200">{error}</div> : null}
            </div>
          </section>

          <aside className="flex max-h-[calc(100vh-120px)] min-h-[520px] flex-col rounded-2xl border border-white/10 bg-slate-900 shadow-xl">
            <div className="border-b border-white/10 px-4 py-3">
              <div className="text-sm font-semibold">{copy.transcript}</div>
              <div className="mt-1 text-[10px] text-slate-500">{copy.secure}</div>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {messages.length === 0 ? <div className="rounded-xl border border-dashed border-white/10 p-4 text-center text-xs leading-5 text-slate-500">{copy.prejoin}</div> : null}
              {messages.map((message) => (
                <div key={message.id} className={`rounded-xl px-3 py-2.5 text-xs leading-5 ${message.speaker === "candidate" ? "ms-5 bg-indigo-500/15 text-indigo-100" : "me-5 bg-white/5 text-slate-200"}`}>
                  <div className="mb-1 text-[9px] font-semibold uppercase tracking-[.12em] text-slate-500">{message.speaker === "candidate" ? copy.you : copy.interviewer}</div>
                  {message.text}
                </div>
              ))}
            </div>
            <div className="border-t border-white/10 p-4 text-[10px] leading-5 text-slate-500">{copy.privacy}</div>
          </aside>
        </div>
      </div>
    </main>
  );
}

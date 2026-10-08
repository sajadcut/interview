"use client";

import { useEffect, useRef, useState } from "react";
import {
  candidateInterviewFallbacks,
  candidateInterviewReducer,
  createCandidateInterviewState,
  mediaPermissionReady,
  type CandidateInterviewErrorCode,
  type CandidateInterviewPhase,
  type CandidateMediaPermissionState,
} from "../../lib/candidate-interview-state";
import { candidateInterviewUiCopy } from "../../lib/candidate-interview-copy";
import { CANDIDATE_PREVIEW_HANDOFF_KEY, CandidateDevicePreview } from "../../lib/candidate-device-preview";
import type {
  CandidateRuntimeAnswer,
  CandidateRuntimeCompletion,
  CandidateRuntimeEvent,
  CandidateRuntimeSnapshot,
  CandidateRuntimeVoiceAnswer,
} from "../../lib/candidate-realtime-runtime";
import { getDefaultLocale } from "../../lib/i18n";
import { localizeApiMessage } from "../../lib/api";
import { formatFaDigits, formatFaNumber } from "../../lib/fa-numbers";

const TARGET_SAMPLE_RATE = 16_000;
const SILENCE_TO_SUBMIT_MS = 1_400;
const MAX_VOICE_ANSWER_MS = 90_000;
const SPEECH_RMS_THRESHOLD = 0.018;

type MediaRequestMode = "full" | "audio-only";
type MediaFailureCode = "permission_denied" | "device_unavailable";

export interface CandidateInterviewRuntime {
  connect(input: { stream: MediaStream; audioOnly: boolean }): Promise<void | CandidateRuntimeSnapshot>;
  reconnect?(input: { stream: MediaStream; audioOnly: boolean }): Promise<void | CandidateRuntimeSnapshot>;
  disconnect?(): Promise<void>;
  subscribe?(listener: (event: CandidateRuntimeEvent) => void): () => void;
  turnAudio?(turnId: string): Promise<Blob>;
  submitText?(text: string): Promise<CandidateRuntimeAnswer>;
  submitVoice?(audio: Blob): Promise<CandidateRuntimeVoiceAnswer>;
  acknowledgeTurnPlayed?(turnId: string): Promise<CandidateRuntimeCompletion>;
  sync?(): Promise<{
    status: "active" | "completed";
    lifecyclePhase: CandidateRuntimeSnapshot["lifecyclePhase"];
    sessionId: string;
    remainingSeconds: number;
    clock: CandidateRuntimeSnapshot["clock"];
    turn: CandidateRuntimeSnapshot["turn"];
  }>;
  reportIntegrity?(input: {
    eventType:
      | "visibility_hidden" | "visibility_visible" | "window_blur" | "window_focus"
      | "large_paste" | "reconnect" | "network_disconnect" | "network_reconnect"
      | "media_device_changed" | "microphone_disabled" | "microphone_enabled"
      | "camera_disabled" | "camera_enabled" | "unexpected_room_participant"
      | "answer_submission_spike";
    clientOccurredAt?: string;
    durationMs?: number;
    metadata?: {
      field?: string; characterCount?: number; answerLength?: number; phase?: string;
      currentTurnId?: string; remainingSeconds?: number; participantCount?: number;
      reconnectCount?: number; duringAnswer?: boolean; deviceKind?: string;
    };
  }): Promise<void>;
}

export interface CandidateInterviewExperienceProps {
  candidateName: string;
  jobTitle: string;
  sessionExpiresAt: string;
  interviewDurationMinutes: number;
  interviewType: string;
  integrityPolicy: {
    observableSignalsOnly: true;
    automaticCheatingDecision: false;
    automaticScorePenalty: false;
    humanReviewRequiredForConcern: true;
  };
  runtime?: CandidateInterviewRuntime;
}

const secondaryButton =
  "min-h-11 rounded-xl border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40";

function permissionFromBrowser(value: PermissionState): CandidateMediaPermissionState {
  return value === "granted" || value === "denied" || value === "prompt" ? value : "unknown";
}

async function readPermission(name: "microphone" | "camera"): Promise<CandidateMediaPermissionState> {
  if (!navigator.permissions?.query) return "unknown";
  try {
    return permissionFromBrowser(
      (await navigator.permissions.query({ name: name as PermissionName })).state,
    );
  } catch {
    return "unknown";
  }
}

function mediaFailureCode(cause: unknown): MediaFailureCode {
  return cause instanceof DOMException &&
    ["NotAllowedError", "SecurityError", "PermissionDeniedError"].includes(cause.name)
    ? "permission_denied"
    : "device_unavailable";
}

function candidateFacingError(cause: unknown, fallback: string): string {
  if (!(cause instanceof Error)) return fallback;
  const localized = localizeApiMessage(cause.message);
  return /[\u0600-\u06FF]/.test(localized) ? localized : fallback;
}

function connectionFailureCode(
  cause: unknown,
): "transport_timeout" | "transport_unavailable" | "unexpected" {
  if (
    (cause instanceof DOMException && ["TimeoutError", "AbortError"].includes(cause.name)) ||
    (cause instanceof Error && /timeout/i.test(cause.message))
  ) {
    return "transport_timeout";
  }
  return cause instanceof Error || cause instanceof DOMException
    ? "transport_unavailable"
    : "unexpected";
}

function phaseTone(phase: CandidateInterviewPhase): string {
  if (phase === "live") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (phase === "connecting" || phase === "reconnecting") return "bg-sky-50 text-sky-700 ring-sky-200";
  if (phase === "offline" || phase === "degraded") return "bg-amber-50 text-amber-800 ring-amber-200";
  if (phase === "fatal") return "bg-rose-50 text-rose-700 ring-rose-200";
  return "bg-slate-100 text-slate-700 ring-slate-200";
}

function permissionTone(permission: CandidateMediaPermissionState): string {
  if (permission === "granted") return "bg-emerald-50 text-emerald-700";
  if (permission === "denied" || permission === "unavailable") return "bg-rose-50 text-rose-700";
  if (permission === "prompt") return "bg-amber-50 text-amber-800";
  return "bg-slate-100 text-slate-600";
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
  if (sourceRate < targetRate) throw new Error(`Unsupported microphone sample rate: ${sourceRate} Hz`);
  const ratio = sourceRate / targetRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);
  for (let index = 0; index < outputLength; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(input.length, Math.max(start + 1, Math.floor((index + 1) * ratio)));
    let sum = 0;
    for (let sourceIndex = start; sourceIndex < end; sourceIndex += 1) {
      sum += input[sourceIndex] ?? 0;
    }
    output[index] = sum / Math.max(1, end - start);
  }
  return output;
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
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

function formatCountdown(seconds: number, locale: string): string {
  const safe = Math.max(0, Math.trunc(seconds));
  const value = `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
  return locale.toLowerCase().startsWith("fa") ? formatFaDigits(value) : value;
}

function roomCopy(locale: string) {
  const fa = locale.toLowerCase().startsWith("fa");
  return fa
    ? {
        interviewer: "مصاحبه‌گر هوشمند",
        interviewerAudio: "مصاحبه‌گر فعلاً صوتی است. وقتی آواتار ویدیویی به اتاق متصل شود، تصویر او همین‌جا نمایش داده می‌شود.",
        you: "شما",
        conversation: "گفت‌وگو",
        yourTurn: "نوبت شماست؛ صحبت کنید یا پاسخ را تایپ کنید.",
        speaking: "مصاحبه‌گر در حال صحبت است…",
        processing: "در حال پردازش پاسخ…",
        voice: "پاسخ صوتی",
        listening: "در حال شنیدن… بعد از مکث کوتاه پاسخ خودکار ارسال می‌شود.",
        noSpeech: "صدایی تشخیص داده نشد. دوباره تلاش کنید.",
        emptySpeech: "گفتار تشخیص داده شد اما متن قابل استفاده‌ای تولید نشد.",
        typedPlaceholder: "یا پاسخ خود را اینجا تایپ کنید…",
        send: "ارسال پاسخ",
        replay: "پخش دوباره سؤال",
        speakerOn: "صدا روشن",
        speakerOff: "صدا خاموش",
        reconnect: "اتصال مجدد",
        offline: "اینترنت قطع است؛ نشست شما حفظ شده است.",
        paused: "مصاحبه موقتاً متوقف شده است. اتصال را دوباره برقرار کنید.",
        completed: "مصاحبه با موفقیت تکمیل شد",
        completedBody: "پاسخ‌های شما ثبت شد. می‌توانید این صفحه را ببندید.",
        privacy: "صوت و ویدیوی خام در دیتابیس API ذخیره نمی‌شود؛ فقط متن نهایی لازم برای مصاحبه و ارزیابی نگهداری می‌شود.",
        remaining: "زمان باقی‌مانده",
        endingSoon: "کمتر از ۵ دقیقه تا پایان",
        finalMinute: "مصاحبه در حال جمع‌بندی است",
        integrity: "فقط رخدادهای قابل مشاهده مانند خروج از صفحه، بازگشت، قطع اتصال و چسباندن حجم زیادی از متن ثبت می‌شوند. محتوای حافظهٔ موقت ذخیره نمی‌شود و این سیگنال‌ها به‌تنهایی اثبات تقلب یا دلیل رد خودکار نیستند.",
        lifecycle: {
          introduction: "معرفی مصاحبه",
          active: "مصاحبه فعال",
          transition: "تغییر موضوع / روشن‌سازی",
          candidate_question: "جمع‌بندی و فرصت سؤال شما",
          closing: "خداحافظی",
          completed: "پایان",
        },
      }
    : {
        interviewer: "AI Interviewer",
        interviewerAudio: "The interviewer is audio-first for now. When a video avatar joins the room, its video appears here.",
        you: "You",
        conversation: "Conversation",
        yourTurn: "Your turn. Speak or type your answer.",
        speaking: "Interviewer is speaking…",
        processing: "Processing answer…",
        voice: "Answer by voice",
        listening: "Listening… your answer submits automatically after a short pause.",
        noSpeech: "No speech was detected. Please try again.",
        emptySpeech: "Speech was detected but no usable transcript was produced.",
        typedPlaceholder: "Or type your answer here…",
        send: "Send answer",
        replay: "Replay question",
        speakerOn: "Speaker on",
        speakerOff: "Speaker off",
        reconnect: "Reconnect",
        offline: "You are offline. Your secure session is preserved.",
        paused: "The interview is paused. Reconnect to continue.",
        completed: "Interview completed successfully",
        completedBody: "Your answers were saved. You may close this page.",
        privacy: "Raw audio/video is not persisted in the API database; only finalized text needed for the interview and evaluation is retained.",
        remaining: "Time remaining",
        endingSoon: "Less than 5 minutes remaining",
        finalMinute: "The interview is wrapping up",
        integrity: "Only observable session-integrity events are recorded. Clipboard contents are not stored and signals are never automatic proof of cheating.",
        lifecycle: {
          introduction: "Interview introduction",
          active: "Interview active",
          transition: "Topic transition / clarification",
          candidate_question: "Wrap-up and your question",
          closing: "Closing",
          completed: "Finished",
        },
      };
}

export function CandidateInterviewExperience({
  candidateName,
  jobTitle,
  sessionExpiresAt,
  interviewDurationMinutes,
  interviewType,
  integrityPolicy,
  runtime,
}: CandidateInterviewExperienceProps) {
  const locale = getDefaultLocale();
  const copy = candidateInterviewUiCopy[locale];
  const liveCopy = roomCopy(locale);
  const [state, setState] = useState(() =>
    createCandidateInterviewState({
      runtimeAvailable: Boolean(runtime),
      online: typeof navigator === "undefined" ? true : navigator.onLine,
    }),
  );
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [hasLocalMedia, setHasLocalMedia] = useState(false);
  const [networkRestored, setNetworkRestored] = useState(false);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [speakerEnabled, setSpeakerEnabled] = useState(true);
  const [runtimeSnapshot, setRuntimeSnapshot] = useState<CandidateRuntimeSnapshot | null>(null);
  const [remoteVideoTrack, setRemoteVideoTrack] = useState<MediaStreamTrack | null>(null);
  const [remoteAudioTrack, setRemoteAudioTrack] = useState<MediaStreamTrack | null>(null);
  const [typedAnswer, setTypedAnswer] = useState("");
  const [answerBusy, setAnswerBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [liveStatus, setLiveStatus] = useState(liveCopy.yourTurn);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [displayRemainingSeconds, setDisplayRemainingSeconds] = useState(interviewDurationMinutes * 60);

  const streamRef = useRef<MediaStream | null>(null);
  const mediaControllerRef = useRef<CandidateDevicePreview | null>(null);
  const mediaRequestIdRef = useRef(0);
  const autoStartFromSetupRef = useRef<boolean | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsUrlRef = useRef<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const sampleCountRef = useRef(0);
  const listeningRef = useRef(false);
  const speechSeenRef = useRef(false);
  const lastSpeechRef = useRef(0);
  const voiceStartedRef = useRef(0);
  const maxVoiceTimerRef = useRef<number | null>(null);
  const hiddenAtRef = useRef<number | null>(null);
  const blurAtRef = useRef<number | null>(null);
  const networkDownAtRef = useRef<number | null>(null);
  const lastLargePasteAtRef = useRef<number | null>(null);
  const closeTurnPlayedRef = useRef<string | null>(null);

  const reduce = (event: Parameters<typeof candidateInterviewReducer>[1]) =>
    setState((current) => candidateInterviewReducer(current, event));

  const releaseStream = (updateUi = true) => {
    mediaControllerRef.current?.stop();
    mediaControllerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (updateUi) setHasLocalMedia(false);
  };

  const installStream = (stream: MediaStream) => {
    releaseStream(false);
    streamRef.current = stream;
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
      void localVideoRef.current.play().catch(() => undefined);
    }
    setHasLocalMedia(true);
    setMicrophoneEnabled(true);
    setCameraEnabled(stream.getVideoTracks().some((track) => track.readyState === "live"));
  };

  const inspectPermissions = async (failureCode?: MediaFailureCode) => {
    const [microphone, camera] = await Promise.all([
      readPermission("microphone"),
      readPermission("camera"),
    ]);
    setState((current) => {
      let next = candidateInterviewReducer(current, {
        type: "PERMISSIONS_RESOLVED",
        microphone,
        camera,
      });
      if (failureCode) {
        next = candidateInterviewReducer(next, { type: "PERMISSION_FAILED", code: failureCode });
      }
      return next;
    });
  };

  const requestMedia = async (mode: MediaRequestMode) => {
    const requestId = ++mediaRequestIdRef.current;
    setPermissionBusy(true);
    setNetworkRestored(false);
    releaseStream();
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        reduce({ type: "PERMISSION_FAILED", code: "device_unavailable" });
        return;
      }

      // The setup preview has just released its tracks. Opening microphone and
      // camera in one combined request can fail while one device is still busy.
      // Acquire independently and retry transient camera errors without losing
      // a healthy microphone. Never mark permission as a live device.
      const controller = new CandidateDevicePreview({
        getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
      });
      mediaControllerRef.current = controller;
      const result = await controller.start({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: mode === "full"
          ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" }
          : false,
        cameraRetryDelaysMs: mode === "full" ? [350, 700] : [],
        microphoneRetryDelaysMs: [350, 700],
      });
      if (!result || requestId !== mediaRequestIdRef.current) {
        controller.stop();
        return;
      }

      if (mode === "full" && !result.camera) {
        controller.stop();
        if (mediaControllerRef.current === controller) mediaControllerRef.current = null;
        reduce({
          type: "PERMISSIONS_RESOLVED",
          microphone: "granted",
          camera: mediaFailureCode(result.cameraError) === "permission_denied" ? "denied" : "unavailable",
          audioOnly: false,
        });
        reduce({ type: "PERMISSION_FAILED", code: mediaFailureCode(result.cameraError) });
        return;
      }

      const tracks = [
        ...result.microphone.getAudioTracks(),
        ...(result.camera?.getVideoTracks() ?? []),
      ];
      const stream = new MediaStream(tracks);
      if (!stream.getAudioTracks().some((track) => track.readyState === "live")) {
        controller.stop();
        if (mediaControllerRef.current === controller) mediaControllerRef.current = null;
        reduce({ type: "PERMISSION_FAILED", code: "device_unavailable" });
        return;
      }

      // installStream releases the previous preview, so take ownership of the
      // new controller only after the new stream has been installed.
      mediaControllerRef.current = null;
      installStream(stream);
      mediaControllerRef.current = controller;
      reduce({
        type: "PERMISSIONS_RESOLVED",
        microphone: "granted",
        camera: result.camera ? "granted" : "unavailable",
        audioOnly: mode === "audio-only",
      });
    } catch (cause) {
      if (requestId !== mediaRequestIdRef.current) return;
      releaseStream();
      const code = mediaFailureCode(cause);
      reduce({
        type: "PERMISSIONS_RESOLVED",
        microphone: code === "permission_denied" ? "denied" : "unavailable",
        camera: "unknown",
        audioOnly: false,
      });
      reduce({ type: "PERMISSION_FAILED", code });
    } finally {
      if (requestId === mediaRequestIdRef.current) setPermissionBusy(false);
    }
  };

  const applySnapshot = (snapshot: CandidateRuntimeSnapshot) => {
    setRuntimeSnapshot(snapshot);
    setDisplayRemainingSeconds(snapshot.clock?.remainingSeconds ?? snapshot.remainingSeconds);
  };

  const playTurn = async (turnId: string) => {
    if (!runtime?.turnAudio) return;
    setLiveStatus(liveCopy.speaking);
    setLiveError(null);
    try {
      const blob = await runtime.turnAudio(turnId);
      if (ttsUrlRef.current) URL.revokeObjectURL(ttsUrlRef.current);
      const url = URL.createObjectURL(blob);
      ttsUrlRef.current = url;
      const audio = new Audio(url);
      audio.muted = !speakerEnabled;
      ttsAudioRef.current = audio;
      await audio.play();
      await new Promise<void>((resolve) => {
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
      });
    } catch (cause) {
      setLiveError(candidateFacingError(cause, copy.error.unexpected));
    } finally {
      if (state.phase !== "completed") setLiveStatus(liveCopy.yourTurn);
    }
  };

  const finishAfterCloseTurn = async (turnId: string) => {
    if (closeTurnPlayedRef.current !== turnId) {
      closeTurnPlayedRef.current = turnId;
      await playTurn(turnId);
    }
    if (!runtime?.acknowledgeTurnPlayed) {
      throw new Error("Closing acknowledgement is unavailable");
    }
    const completion = await runtime.acknowledgeTurnPlayed(turnId);
    setDisplayRemainingSeconds(completion.clock.remainingSeconds);
    setRuntimeSnapshot((current) => current ? {
      ...current,
      status: "completed",
      lifecyclePhase: "completed",
      remainingSeconds: completion.remainingSeconds,
      clock: completion.clock,
    } : current);
    reduce({ type: "COMPLETE" });
    setLiveStatus(liveCopy.completed);
  };

  const attemptConnection = async (reconnect = false) => {
    if (!hasLocalMedia || !streamRef.current) {
      reduce({ type: "PERMISSION_FAILED", code: "device_unavailable" });
      return;
    }
    if (state.network === "offline") {
      reduce({ type: "NETWORK_OFFLINE" });
      return;
    }
    setConnectionBusy(true);
    setLiveError(null);
    reduce({ type: "CONNECT_REQUESTED" });
    try {
      if (!runtime) throw new Error(copy.connection.runtimePending);
      const snapshot =
        reconnect && runtime.reconnect
          ? await runtime.reconnect({ stream: streamRef.current, audioOnly: state.audioOnly })
          : await runtime.connect({ stream: streamRef.current, audioOnly: state.audioOnly });
      if (snapshot) applySnapshot(snapshot);
      reduce({ type: reconnect ? "TRANSPORT_RECONNECTED" : "CONNECTED" });
      if (reconnect) {
        void runtime.reportIntegrity?.({ eventType: "reconnect", clientOccurredAt: new Date().toISOString() }).catch(() => undefined);
      }
      if (snapshot) {
        let currentSnapshot = snapshot;
        if (snapshot.openingTurn) {
          await playTurn(snapshot.openingTurn.id);
          if (runtime.sync) {
            const synced = await runtime.sync();
            currentSnapshot = {
              ...snapshot,
              status: synced.status,
              lifecyclePhase: synced.status === "completed" ? "completed" : synced.lifecyclePhase,
              openingTurn: undefined,
              remainingSeconds: synced.remainingSeconds,
              clock: synced.clock,
              turn: synced.turn,
            };
          } else {
            currentSnapshot = {
              ...snapshot,
              lifecyclePhase: snapshot.turn.action === "close" ? "closing" : "active",
              openingTurn: undefined,
            };
          }
          applySnapshot(currentSnapshot);
        }
        if (currentSnapshot.status === "completed" || currentSnapshot.turn.action === "close") {
          await finishAfterCloseTurn(currentSnapshot.turn.id);
        } else {
          await playTurn(currentSnapshot.turn.id);
        }
      }
    } catch (cause) {
      setLiveError(candidateFacingError(cause, copy.error.unexpected));
      reduce({ type: "CONNECTION_FAILED", code: connectionFailureCode(cause) });
    } finally {
      setConnectionBusy(false);
    }
  };

  const stopCaptureNodes = () => {
    if (maxVoiceTimerRef.current !== null) window.clearTimeout(maxVoiceTimerRef.current);
    maxVoiceTimerRef.current = null;
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    gainRef.current?.disconnect();
    processorRef.current = null;
    sourceRef.current = null;
    gainRef.current = null;
  };

  const finishVoiceAnswer = async () => {
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
      setLiveStatus(liveCopy.noSpeech);
      return;
    }

    setAnswerBusy(true);
    setLiveStatus(liveCopy.processing);
    setLiveError(null);
    try {
      if (!runtime?.submitVoice) throw new Error(copy.connection.runtimePending);
      const merged = mergeFloat32(chunksRef.current, sampleCountRef.current);
      const normalized = downsampleMono(merged, sourceRate, TARGET_SAMPLE_RATE);
      const result = await runtime.submitVoice(encodePcm16Wav(normalized, TARGET_SAMPLE_RATE));
      if (!result.speechDetected) {
        setLiveStatus(liveCopy.noSpeech);
        return;
      }
      if (!result.transcript?.text || !result.turn) {
        setLiveStatus(liveCopy.emptySpeech);
        return;
      }
      setDisplayRemainingSeconds(result.clock?.remainingSeconds ?? result.remainingSeconds ?? displayRemainingSeconds);
      if (result.completed || result.turn.action === "close") {
        await finishAfterCloseTurn(result.turn.id);
      } else {
        await playTurn(result.turn.id);
      }
    } catch (cause) {
      setLiveError(candidateFacingError(cause, copy.error.unexpected));
      setLiveStatus(liveCopy.yourTurn);
    } finally {
      chunksRef.current = [];
      sampleCountRef.current = 0;
      setAnswerBusy(false);
    }
  };

  const startVoiceAnswer = async () => {
    if (
      !runtime?.submitVoice ||
      !streamRef.current ||
      answerBusy ||
      listening ||
      !microphoneEnabled ||
      state.phase !== "live"
    ) {
      return;
    }
    const micTrack = streamRef.current
      .getAudioTracks()
      .find((track) => track.readyState === "live" && track.enabled);
    if (!micTrack) {
      setLiveError(copy.permissions.microphoneRequired);
      return;
    }

    setLiveError(null);
    chunksRef.current = [];
    sampleCountRef.current = 0;
    speechSeenRef.current = false;
    voiceStartedRef.current = performance.now();
    lastSpeechRef.current = voiceStartedRef.current;

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
      const samples = new Float32Array(input.length);
      samples.set(input);
      chunksRef.current.push(samples);
      sampleCountRef.current += samples.length;
      let energy = 0;
      for (const sample of input) energy += sample * sample;
      const rms = Math.sqrt(energy / Math.max(1, input.length));
      const now = performance.now();
      if (rms >= SPEECH_RMS_THRESHOLD) {
        speechSeenRef.current = true;
        lastSpeechRef.current = now;
      }
      if (
        speechSeenRef.current &&
        now - lastSpeechRef.current >= SILENCE_TO_SUBMIT_MS &&
        now - voiceStartedRef.current >= 1_000
      ) {
        void finishVoiceAnswer();
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
    setLiveStatus(liveCopy.listening);
    maxVoiceTimerRef.current = window.setTimeout(
      () => void finishVoiceAnswer(),
      MAX_VOICE_ANSWER_MS,
    );
  };

  const submitTypedAnswer = async () => {
    const text = typedAnswer.trim();
    if (!text || !runtime?.submitText || answerBusy || state.phase !== "live") return;
    const now = Date.now();
    if (text.length >= 300 && lastLargePasteAtRef.current && now - lastLargePasteAtRef.current <= 5_000) {
      void runtime.reportIntegrity?.({
        eventType: "answer_submission_spike",
        clientOccurredAt: new Date(now).toISOString(),
        metadata: {
          answerLength: text.length,
          phase: state.phase,
          currentTurnId: runtimeSnapshot?.turn.id,
          remainingSeconds: displayRemainingSeconds,
        },
      }).catch(() => undefined);
    }
    setAnswerBusy(true);
    setLiveStatus(liveCopy.processing);
    setLiveError(null);
    try {
      const result = await runtime.submitText(text);
      setTypedAnswer("");
      setDisplayRemainingSeconds(result.clock?.remainingSeconds ?? result.remainingSeconds);
      if (result.completed || result.turn.action === "close") {
        await finishAfterCloseTurn(result.turn.id);
      } else {
        await playTurn(result.turn.id);
      }
    } catch (cause) {
      setLiveError(candidateFacingError(cause, copy.error.unexpected));
      setLiveStatus(liveCopy.yourTurn);
    } finally {
      setAnswerBusy(false);
    }
  };

  useEffect(() => {
    reduce({ type: "BOOTSTRAP", online: navigator.onLine, runtimeAvailable: Boolean(runtime) });
    if (autoStartFromSetupRef.current === null) {
      // Only open media automatically after an explicit check and Continue
      // in candidate setup. Direct entry never starts camera/microphone.
      try {
        autoStartFromSetupRef.current =
          window.sessionStorage.getItem(CANDIDATE_PREVIEW_HANDOFF_KEY) === "1";
        window.sessionStorage.removeItem(CANDIDATE_PREVIEW_HANDOFF_KEY);
      } catch {
        autoStartFromSetupRef.current = false;
      }
    }
    // Defer acquisition until after effect setup. In React Strict Mode the
    // first dev-only setup is cleaned up before this timer fires, preventing
    // competing getUserMedia calls and camera-on/camera-off flicker.
    const startupTimer = autoStartFromSetupRef.current
      ? window.setTimeout(() => void requestMedia("full"), 0)
      : null;
    if (!autoStartFromSetupRef.current) void inspectPermissions();
    const onOffline = () => {
      const now = Date.now();
      networkDownAtRef.current = now;
      setNetworkRestored(false);
      reduce({ type: "NETWORK_OFFLINE" });
      void runtime?.reportIntegrity?.({
        eventType: "network_disconnect",
        clientOccurredAt: new Date(now).toISOString(),
        metadata: { phase: state.phase, currentTurnId: runtimeSnapshot?.turn.id, remainingSeconds: displayRemainingSeconds },
      }).catch(() => undefined);
    };
    const onOnline = () => {
      const now = Date.now();
      const disconnectedAt = networkDownAtRef.current;
      networkDownAtRef.current = null;
      setNetworkRestored(true);
      reduce({ type: "NETWORK_ONLINE" });
      void runtime?.reportIntegrity?.({
        eventType: "network_reconnect",
        clientOccurredAt: new Date(now).toISOString(),
        ...(disconnectedAt ? { durationMs: Math.max(0, now - disconnectedAt) } : {}),
        metadata: { phase: state.phase, currentTurnId: runtimeSnapshot?.turn.id, remainingSeconds: displayRemainingSeconds },
      }).catch(() => undefined);
    };
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      if (startupTimer !== null) window.clearTimeout(startupTimer);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      mediaRequestIdRef.current += 1;
      releaseStream(false);
      void runtime?.disconnect?.().catch(() => undefined);
    };
  }, [runtime]);

  useEffect(() => {
    const unsubscribe = runtime?.subscribe?.((event) => {
      if (event.type === "snapshot") applySnapshot(event.snapshot);
      if (event.type === "remote_video") setRemoteVideoTrack(event.track);
      if (event.type === "remote_audio") setRemoteAudioTrack(event.track);
      if (event.type === "reconnecting") reduce({ type: "TRANSPORT_RECONNECTING" });
      if (event.type === "reconnected") {
        reduce({ type: "TRANSPORT_RECONNECTED" });
        void runtime?.reportIntegrity?.({ eventType: "reconnect", clientOccurredAt: new Date().toISOString() }).catch(() => undefined);
      }
      if (event.type === "disconnected") {
        reduce({ type: "CONNECTION_FAILED", code: "transport_unavailable" });
      }
    });
    return () => unsubscribe?.();
  }, [runtime]);

  useEffect(() => {
    if (!runtimeSnapshot || state.phase === "completed") return;
    const tick = window.setInterval(() => setDisplayRemainingSeconds((value) => Math.max(0, value - 1)), 1_000);
    return () => window.clearInterval(tick);
  }, [runtimeSnapshot?.sessionId, state.phase]);

  useEffect(() => {
    if (!runtimeSnapshot || !runtime?.sync || state.phase === "completed") return;
    let active = true;
    const synchronize = async () => {
      try {
        const previousTurnId = runtimeSnapshot.turn.id;
        const synced = await runtime.sync!();
        if (!active) return;
        setDisplayRemainingSeconds(synced.clock.remainingSeconds);
        setRuntimeSnapshot((current) => current ? {
          ...current,
          status: synced.status,
          lifecyclePhase: synced.status === "completed" ? "completed" : synced.lifecyclePhase,
          remainingSeconds: synced.remainingSeconds,
          clock: synced.clock,
          turn: synced.turn,
        } : current);
        if (synced.status === "completed" || synced.turn.action === "close") {
          await finishAfterCloseTurn(synced.turn.id);
        } else if (synced.turn.id !== previousTurnId) {
          await playTurn(synced.turn.id);
        }
      } catch {
        // Transport recovery owns connection errors; clock resync must not terminate the interview.
      }
    };
    void synchronize();
    const timer = window.setInterval(() => void synchronize(), 10_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [runtime, runtimeSnapshot?.sessionId, runtimeSnapshot?.turn.id, state.phase]);

  useEffect(() => {
    if (!runtimeSnapshot || !runtime?.reportIntegrity || state.phase !== "live") return;
    const report = (input: Parameters<NonNullable<CandidateInterviewRuntime["reportIntegrity"]>>[0]) =>
      void runtime.reportIntegrity!(input).catch(() => undefined);
    const onVisibility = () => {
      const now = Date.now();
      if (document.visibilityState === "hidden") {
        hiddenAtRef.current = now;
        report({
          eventType: "visibility_hidden",
          clientOccurredAt: new Date(now).toISOString(),
          metadata: {
            phase: state.phase,
            currentTurnId: runtimeSnapshot.turn.id,
            remainingSeconds: displayRemainingSeconds,
            duringAnswer: answerBusy || listening,
          },
        });
      } else {
        const hiddenAt = hiddenAtRef.current;
        hiddenAtRef.current = null;
        report({
          eventType: "visibility_visible",
          clientOccurredAt: new Date(now).toISOString(),
          ...(hiddenAt ? { durationMs: Math.max(0, now - hiddenAt) } : {}),
          metadata: {
            phase: state.phase,
            currentTurnId: runtimeSnapshot.turn.id,
            remainingSeconds: displayRemainingSeconds,
            duringAnswer: answerBusy || listening,
          },
        });
      }
    };
    const onBlur = () => {
      const now = Date.now();
      blurAtRef.current = now;
      report({
        eventType: "window_blur",
        clientOccurredAt: new Date(now).toISOString(),
        metadata: { phase: state.phase, currentTurnId: runtimeSnapshot.turn.id, remainingSeconds: displayRemainingSeconds, duringAnswer: answerBusy || listening },
      });
    };
    const onFocus = () => {
      const now = Date.now();
      const blurredAt = blurAtRef.current;
      blurAtRef.current = null;
      report({
        eventType: "window_focus",
        clientOccurredAt: new Date(now).toISOString(),
        ...(blurredAt ? { durationMs: Math.max(0, now - blurredAt) } : {}),
        metadata: { phase: state.phase, currentTurnId: runtimeSnapshot.turn.id, remainingSeconds: displayRemainingSeconds, duringAnswer: answerBusy || listening },
      });
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, [
    runtime,
    runtimeSnapshot?.sessionId,
    runtimeSnapshot?.turn.id,
    state.phase,
    displayRemainingSeconds,
    answerBusy,
    listening,
  ]);

  useEffect(() => {
    if (!navigator.mediaDevices?.addEventListener || !runtimeSnapshot || state.phase === "completed") return;
    const onDeviceChange = () => {
      void runtime?.reportIntegrity?.({
        eventType: "media_device_changed",
        clientOccurredAt: new Date().toISOString(),
        metadata: { phase: state.phase, currentTurnId: runtimeSnapshot.turn.id, remainingSeconds: displayRemainingSeconds },
      }).catch(() => undefined);
    };
    navigator.mediaDevices.addEventListener("devicechange", onDeviceChange);
    return () => navigator.mediaDevices.removeEventListener("devicechange", onDeviceChange);
  }, [runtime, runtimeSnapshot?.sessionId, runtimeSnapshot?.turn.id, state.phase, displayRemainingSeconds]);

  useEffect(() => {
    const expiresAt = new Date(sessionExpiresAt).getTime();
    const verify = () => {
      if (Number.isFinite(expiresAt) && Date.now() >= expiresAt) reduce({ type: "SESSION_EXPIRED" });
    };
    verify();
    const timer = window.setInterval(verify, 30_000);
    return () => window.clearInterval(timer);
  }, [sessionExpiresAt]);

  useEffect(() => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = streamRef.current;
      if (streamRef.current?.getVideoTracks().some((track) => track.readyState === "live")) {
        void localVideoRef.current.play().catch(() => undefined);
      }
    }
  }, [hasLocalMedia, state.phase]);

  useEffect(() => {
    if (!remoteVideoRef.current) return;
    remoteVideoRef.current.srcObject = remoteVideoTrack ? new MediaStream([remoteVideoTrack]) : null;
  }, [remoteVideoTrack, state.phase]);

  useEffect(() => {
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = remoteAudioTrack ? new MediaStream([remoteAudioTrack]) : null;
      remoteAudioRef.current.muted = !speakerEnabled;
      if (remoteAudioTrack && speakerEnabled) void remoteAudioRef.current.play().catch(() => undefined);
    }
    if (ttsAudioRef.current) ttsAudioRef.current.muted = !speakerEnabled;
  }, [remoteAudioTrack, speakerEnabled, state.phase]);

  useEffect(() => {
    return () => {
      listeningRef.current = false;
      stopCaptureNodes();
      void audioContextRef.current?.close();
      if (ttsUrlRef.current) URL.revokeObjectURL(ttsUrlRef.current);
    };
  }, []);

  const permissionLabels: Record<CandidateMediaPermissionState, string> = {
    unknown: copy.permissions.unknown,
    prompt: copy.permissions.prompt,
    granted: copy.permissions.granted,
    denied: copy.permissions.denied,
    unavailable: copy.permissions.unavailable,
  };
  const errorMessages: Record<CandidateInterviewErrorCode, string> = copy.error;
  const permissionReady = mediaPermissionReady(state);
  const fallbacks = candidateInterviewFallbacks(state);
  const showAudioOnly =
    state.microphone === "granted" &&
    !state.audioOnly &&
    ["denied", "unavailable"].includes(state.camera);
  const canConnect =
    permissionReady &&
    hasLocalMedia &&
    state.network === "online" &&
    !connectionBusy &&
    !["fatal", "completed"].includes(state.phase);
  const inInterviewRoom = Boolean(
    runtimeSnapshot && state.hasConnected && !["fatal", "completed"].includes(state.phase),
  );

  const toggleMicrophone = () => {
    const next = !microphoneEnabled;
    streamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = next;
    });
    setMicrophoneEnabled(next);
    void runtime?.reportIntegrity?.({
      eventType: next ? "microphone_enabled" : "microphone_disabled",
      clientOccurredAt: new Date().toISOString(),
      metadata: { phase: state.phase, currentTurnId: runtimeSnapshot?.turn.id, remainingSeconds: displayRemainingSeconds },
    }).catch(() => undefined);
  };

  const toggleCamera = () => {
    const next = !cameraEnabled;
    streamRef.current?.getVideoTracks().forEach((track) => {
      track.enabled = next;
    });
    setCameraEnabled(next);
    void runtime?.reportIntegrity?.({
      eventType: next ? "camera_enabled" : "camera_disabled",
      clientOccurredAt: new Date().toISOString(),
      metadata: { phase: state.phase, currentTurnId: runtimeSnapshot?.turn.id, remainingSeconds: displayRemainingSeconds },
    }).catch(() => undefined);
  };

  if (state.phase === "completed" && runtimeSnapshot) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 px-4 py-10">
        <section className="w-full max-w-2xl rounded-3xl border border-emerald-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-50 text-2xl text-emerald-700">✓</div>
          <h1 className="mt-5 text-2xl font-semibold text-slate-950">{liveCopy.completed}</h1>
          <p className="mt-2 text-sm text-slate-600">{liveCopy.completedBody}</p>
          <div className="mt-6 rounded-2xl bg-slate-50 p-4 text-start text-xs text-slate-600">
            {locale === "fa" ? formatFaNumber(runtimeSnapshot.transcript.length) : runtimeSnapshot.transcript.length} {liveCopy.conversation.toLowerCase()}
          </div>
        </section>
      </main>
    );
  }

  if (inInterviewRoom && runtimeSnapshot) {
    const canAnswer = state.phase === "live" && state.network === "online" && !answerBusy && !listening;
    return (
      <main className="min-h-screen bg-slate-950 p-3 text-slate-100 sm:p-5">
        <div className="mx-auto max-w-7xl space-y-3">
          <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 shadow-xl">
            <div>
              <div className="text-sm font-semibold">{copy.eyebrow}</div>
              <div className="mt-1 text-[11px] text-slate-400">{copy.hello} {candidateName} · {copy.role}: {jobTitle}</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className={`rounded-full px-3 py-1.5 text-[11px] font-semibold tabular-nums ${displayRemainingSeconds <= 60 ? "bg-rose-400/15 text-rose-200" : displayRemainingSeconds <= 300 ? "bg-amber-400/15 text-amber-200" : "bg-white/10 text-slate-100"}`}>
                {liveCopy.remaining}: {formatCountdown(displayRemainingSeconds, locale)}
              </div>
              <div className="rounded-full bg-indigo-400/10 px-3 py-1.5 text-[10px] font-semibold text-indigo-200">
                {liveCopy.lifecycle[runtimeSnapshot.lifecyclePhase]}
              </div>
              <div className={`rounded-full px-3 py-1.5 text-[10px] font-semibold ${state.phase === "live" ? "bg-emerald-400/10 text-emerald-300" : "bg-amber-400/10 text-amber-200"}`}>
                {copy.stage[state.phase]}
              </div>
            </div>
          </header>
          {displayRemainingSeconds <= 300 ? <div role="status" className={`rounded-xl border px-4 py-2 text-xs ${displayRemainingSeconds <= 60 ? "border-rose-300/20 bg-rose-300/10 text-rose-100" : "border-amber-300/20 bg-amber-300/10 text-amber-100"}`}>{displayRemainingSeconds <= 60 ? liveCopy.finalMinute : liveCopy.endingSoon}</div> : null}

          {state.network === "offline" ? (
            <div role="alert" className="rounded-xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">{liveCopy.offline}</div>
          ) : state.phase === "reconnecting" || state.phase === "degraded" ? (
            <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
              <span>{liveCopy.paused}</span>
              <button type="button" disabled={connectionBusy || !hasLocalMedia} onClick={() => void attemptConnection(true)} className="rounded-lg bg-white/10 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{liveCopy.reconnect}</button>
            </div>
          ) : null}

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
            <section className="overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl">
              <div className="relative aspect-video min-h-[360px]">
                <video ref={remoteVideoRef} autoPlay playsInline className={`h-full w-full object-cover ${remoteVideoTrack ? "" : "hidden"}`} />
                <audio ref={remoteAudioRef} autoPlay />
                {!remoteVideoTrack ? (
                  <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-slate-900 via-slate-950 to-indigo-950 p-8 text-center">
                    <div className="max-w-md">
                      <div className="mx-auto grid h-24 w-24 place-items-center rounded-full border border-white/10 bg-white/5 text-4xl">✦</div>
                      <h2 className="mt-5 text-xl font-semibold">{runtimeSnapshot.interviewer.name || liveCopy.interviewer}</h2>
                      <p className="mt-2 text-sm leading-6 text-slate-400">{liveCopy.interviewerAudio}</p>
                    </div>
                  </div>
                ) : null}

                <div className="absolute bottom-4 end-4 h-36 w-48 overflow-hidden rounded-xl border border-white/20 bg-slate-900 shadow-2xl sm:h-40 sm:w-56">
                  <video ref={localVideoRef} autoPlay muted playsInline className={`h-full w-full object-cover ${cameraEnabled && hasLocalMedia ? "" : "hidden"}`} />
                  {!cameraEnabled || !hasLocalMedia ? <div className="grid h-full place-items-center text-xs text-slate-400">{copy.stage.cameraOff}</div> : null}
                  <div className="absolute bottom-2 start-2 rounded bg-black/50 px-2 py-1 text-[10px]">{liveCopy.you}</div>
                </div>
              </div>

              <div className="border-t border-white/10 bg-slate-900/90 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div aria-live="polite" className="text-sm font-medium">{liveStatus}</div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={toggleMicrophone} className="rounded-xl bg-slate-800 px-3 py-2 text-xs font-semibold text-white">{microphoneEnabled ? copy.controls.microphoneOn : copy.controls.microphoneOff}</button>
                    <button type="button" onClick={toggleCamera} disabled={state.audioOnly} className="rounded-xl bg-slate-800 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">{cameraEnabled ? copy.controls.cameraOn : copy.controls.cameraOff}</button>
                    <button type="button" onClick={() => setSpeakerEnabled((value) => !value)} className="rounded-xl bg-slate-800 px-3 py-2 text-xs font-semibold text-white">{speakerEnabled ? liveCopy.speakerOn : liveCopy.speakerOff}</button>
                    <button type="button" disabled={answerBusy || !runtime?.turnAudio} onClick={() => void playTurn(runtimeSnapshot.turn.id)} className="rounded-xl bg-slate-800 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">{liveCopy.replay}</button>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-[auto_1fr_auto] lg:items-end">
                  <button type="button" onClick={() => void startVoiceAnswer()} disabled={!canAnswer || !microphoneEnabled || !runtime?.submitVoice} className="min-h-12 rounded-xl bg-emerald-500 px-5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:bg-slate-700 disabled:text-slate-400">{listening ? liveCopy.listening : liveCopy.voice}</button>
                  <textarea
                    value={typedAnswer}
                    onChange={(event) => setTypedAnswer(event.target.value)}
                    onPaste={(event) => {
                      const characterCount = event.clipboardData.getData("text").length;
                      if (characterCount >= 80) {
                        const now = Date.now();
                        lastLargePasteAtRef.current = now;
                        void runtime?.reportIntegrity?.({
                          eventType: "large_paste",
                          clientOccurredAt: new Date(now).toISOString(),
                          metadata: {
                            field: "typed_answer",
                            characterCount,
                            phase: state.phase,
                            currentTurnId: runtimeSnapshot.turn.id,
                            remainingSeconds: displayRemainingSeconds,
                            duringAnswer: true,
                          },
                        }).catch(() => undefined);
                      }
                    }}
                    disabled={!canAnswer}
                    rows={2}
                    placeholder={liveCopy.typedPlaceholder}
                    className="min-h-12 w-full resize-y rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-600 focus:border-indigo-400 disabled:opacity-50"
                  />
                  <button type="button" onClick={() => void submitTypedAnswer()} disabled={!canAnswer || !typedAnswer.trim() || !runtime?.submitText} className="min-h-12 rounded-xl bg-indigo-500 px-5 text-sm font-semibold text-white hover:bg-indigo-400 disabled:bg-slate-700 disabled:text-slate-400">{liveCopy.send}</button>
                </div>

                {liveError ? <div role="alert" className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-xs leading-5 text-rose-200">{liveError}</div> : null}
              </div>
            </section>

            <aside className="flex max-h-[calc(100vh-120px)] min-h-[520px] flex-col rounded-2xl border border-white/10 bg-slate-900 shadow-xl">
              <div className="border-b border-white/10 px-4 py-3">
                <div className="text-sm font-semibold">{liveCopy.conversation}</div>
                <div className="mt-1 text-[10px] text-slate-500">{copy.secureSession}</div>
              </div>
              <div className="flex-1 space-y-3 overflow-y-auto p-4">
                {runtimeSnapshot.transcript.map((message, index) => (
                  <div key={`${message.speaker}-${index}`} className={`rounded-xl px-3 py-2.5 text-xs leading-5 ${message.speaker === "candidate" ? "ms-5 bg-indigo-500/15 text-indigo-100" : "me-5 bg-white/5 text-slate-200"}`}>
                    <div className="mb-1 text-[9px] font-semibold uppercase tracking-[.12em] text-slate-500">{message.speaker === "candidate" ? liveCopy.you : liveCopy.interviewer}</div>
                    {message.text}
                  </div>
                ))}
              </div>
              <div className="border-t border-white/10 p-4 text-[10px] leading-5 text-slate-500">{liveCopy.privacy}</div>
            </aside>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-4">
        <header className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <div className="text-[11px] font-semibold uppercase tracking-[.14em] text-indigo-600">{copy.eyebrow}</div>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">{copy.title}</h1>
              <p className="mt-3 text-sm text-slate-600">{copy.hello} {candidateName} · {copy.role}: {jobTitle}</p>
              <p className="mt-3 max-w-2xl text-xs leading-5 text-slate-500">{copy.privacyLine}</p>
            </div>
            <div aria-live="polite" className={`rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ${phaseTone(state.phase)}`}>{copy.stage[state.phase]}</div>
          </div>
          <div className="mt-5 grid gap-2 border-t border-slate-100 pt-4 text-xs text-slate-500 sm:grid-cols-3">
            <div><strong className="font-semibold text-slate-800">{copy.secureSession}</strong></div>
            <div>مدت مصاحبه: <strong className="text-slate-800">{formatFaNumber(interviewDurationMinutes)} دقیقه</strong></div>
            <div className="text-end">{copy.sessionValidUntil}: {formatSessionExpiry(sessionExpiresAt, locale)}</div>
          </div>
          <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-[11px] leading-5 text-indigo-900">
            <strong>یکپارچگی جلسه:</strong> {liveCopy.integrity}
            {integrityPolicy.automaticScorePenalty === false ? <span className="ms-1 font-semibold">این سیگنال‌ها امتیاز فنی یا مهارت نرم را خودکار تغییر نمی‌دهند.</span> : null}
          </div>
        </header>

        {state.network === "offline" ? <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">{copy.network.offline}</div> : networkRestored ? <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{copy.network.restored}</div> : <div role="status" className="sr-only">{copy.network.online}</div>}

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="grid lg:grid-cols-[minmax(0,1.55fr)_minmax(300px,.75fr)]">
            <div className="p-4 sm:p-6">
              <div className="relative aspect-video overflow-hidden rounded-2xl bg-slate-950">
                <video ref={localVideoRef} autoPlay muted playsInline className={`h-full w-full object-cover ${cameraEnabled && hasLocalMedia ? "" : "hidden"}`} />
                {!hasLocalMedia || !cameraEnabled ? <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-slate-900 to-slate-800 p-6 text-center text-white"><div><div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-white/10 text-xl">◉</div><div className="mt-4 text-sm font-semibold">{state.audioOnly ? copy.stage.audioOnly : copy.stage.localPreview}</div><p className="mt-2 max-w-md text-xs leading-5 text-slate-300">{state.audioOnly ? copy.stage.cameraOff : copy.stage.previewPrivate}</p></div></div> : null}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={toggleMicrophone} disabled={!hasLocalMedia} className={secondaryButton}>{microphoneEnabled ? copy.controls.microphoneOn : copy.controls.microphoneOff}</button>
                <button type="button" onClick={toggleCamera} disabled={!hasLocalMedia || state.audioOnly || !streamRef.current?.getVideoTracks().length} className={secondaryButton}>{cameraEnabled ? copy.controls.cameraOn : copy.controls.cameraOff}</button>
              </div>

              {state.error && state.error.code !== "network_offline" ? <div role="alert" className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${state.error.severity === "fatal" ? "border-rose-200 bg-rose-50 text-rose-900" : "border-amber-200 bg-amber-50 text-amber-950"}`}><div className="font-semibold">{errorMessages[state.error.code]}</div>{state.error.code === "permission_denied" ? <p className="mt-1 text-xs leading-5">{copy.permissions.deniedHelp}</p> : null}{state.error.code === "device_unavailable" ? <p className="mt-1 text-xs leading-5">{copy.permissions.unavailableHelp}</p> : null}{state.error.code === "runtime_unavailable" ? <p className="mt-1 text-xs leading-5">{copy.connection.runtimePreserved}</p> : null}{state.error.code === "reconnect_exhausted" ? <p className="mt-1 text-xs leading-5">{copy.connection.reconnectExhausted}</p> : null}{liveError ? <p className="mt-2 text-xs leading-5">{liveError}</p> : null}</div> : null}

              <div className="mt-5 flex flex-wrap gap-2">
                <button type="button" disabled={permissionBusy || state.phase === "fatal" || state.phase === "completed"} onClick={() => void requestMedia("full")} className={secondaryButton}>{permissionBusy ? copy.permissions.checking : hasLocalMedia ? copy.permissions.retryBoth : copy.permissions.enableBoth}</button>
                {showAudioOnly ? <button type="button" disabled={permissionBusy} onClick={() => void requestMedia("audio-only")} className="min-h-11 rounded-xl border border-indigo-200 bg-indigo-50 px-4 text-xs font-semibold text-indigo-800 hover:bg-indigo-100">{copy.permissions.tryAudioOnly}</button> : null}
                <button type="button" disabled={!canConnect} onClick={() => void attemptConnection(state.phase === "reconnecting")} className="min-h-11 rounded-xl bg-slate-950 px-5 text-xs font-semibold text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300">{connectionBusy ? copy.stage.connecting : state.phase === "reconnecting" ? copy.controls.reconnect : runtime ? copy.controls.start : copy.controls.checkRuntime}</button>
              </div>
              {state.audioOnly ? <div role="status" className="mt-4 rounded-xl bg-indigo-50 px-4 py-3 text-xs font-medium text-indigo-800">{copy.permissions.audioOnlyActive}</div> : null}
              {state.phase === "reconnecting" ? <div role="status" className="mt-4 rounded-xl bg-sky-50 px-4 py-3 text-xs text-sky-800">{copy.connection.reconnecting}</div> : null}
            </div>

            <aside className="space-y-5 bg-slate-50/70 p-5 sm:p-7">
              <section>
                <h2 className="text-sm font-semibold text-slate-900">{copy.permissions.title}</h2>
                <p className="mt-1 text-xs leading-5 text-slate-500">{copy.permissions.description}</p>
                <div className="mt-3 space-y-2">{([[copy.permissions.microphone, state.microphone], [copy.permissions.camera, state.camera]] as const).map(([label, permission]) => <div key={label} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-3"><span className="text-xs font-medium text-slate-700">{label}</span><span aria-label={`${label}: ${permissionLabels[permission]}`} className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${permissionTone(permission)}`}>{permissionLabels[permission]}</span></div>)}</div>
                {state.microphone !== "granted" && ["denied", "unavailable"].includes(state.microphone) ? <p className="mt-3 text-[11px] leading-5 text-rose-700">{copy.permissions.microphoneRequired}</p> : null}
              </section>

              <section className="border-t border-slate-200 pt-5">
                <h2 className="text-sm font-semibold text-slate-900">{copy.connection.title}</h2>
                <dl className="mt-3 space-y-2 text-xs"><StatusRow label={copy.connection.browser} value={state.network === "online" ? copy.connection.connected : copy.connection.notConnected} /><StatusRow label={copy.connection.devices} value={permissionReady && hasLocalMedia ? copy.permissions.granted : copy.permissions.unknown} /><StatusRow label={copy.connection.realtime} value={runtime ? copy.connection.available : copy.connection.pending} />{state.reconnectAttempts > 0 ? <StatusRow label={copy.connection.attempt} value={locale === "fa" ? `${formatFaNumber(state.reconnectAttempts)}/${formatFaNumber(state.maxReconnectAttempts)}` : `${state.reconnectAttempts}/${state.maxReconnectAttempts}`} /> : null}</dl>
                {!runtime ? <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] leading-5 text-amber-900">{copy.connection.runtimePending}</div> : null}
              </section>

              {showAudioOnly || fallbacks.includes("resume_later") ? <section className="border-t border-slate-200 pt-5"><h2 className="text-sm font-semibold text-slate-900">{copy.fallback.title}</h2>{showAudioOnly ? <FallbackCard title={copy.fallback.audioOnlyTitle} body={copy.fallback.audioOnlyDescription} /> : null}{fallbacks.includes("resume_later") ? <FallbackCard title={copy.fallback.resumeTitle} body={copy.fallback.resumeDescription} linkLabel={copy.controls.backToSetup} /> : null}</section> : null}
              <section className="border-t border-slate-200 pt-5">
                <h2 className="text-sm font-semibold text-slate-900">طرح مصاحبه</h2>
                <dl className="mt-3 space-y-2 text-xs">
                  <StatusRow label="نوع" value={interviewType} />
                  <StatusRow label="مدت" value={`${formatFaNumber(interviewDurationMinutes)} دقیقه`} />
                  <StatusRow label="سیاست قطع اتصال" value="تایمر سرور ادامه دارد" />
                </dl>
              </section>
              <section className="border-t border-slate-200 pt-5"><h2 className="text-sm font-semibold text-slate-900">{copy.instructionsTitle}</h2><ul className="mt-3 space-y-2 text-[11px] leading-5 text-slate-500">{copy.instructions.map((item) => <li key={item} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />{item}</li>)}</ul></section>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-3"><dt className="text-slate-500">{label}</dt><dd className="text-end font-semibold text-slate-700">{value}</dd></div>;
}

function FallbackCard({ title, body, linkLabel }: { title: string; body: string; linkLabel?: string }) {
  return <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3"><div className="text-xs font-semibold text-slate-900">{title}</div><p className="mt-1 text-[11px] leading-5 text-slate-500">{body}</p>{linkLabel ? <a href="/candidate/setup" className="mt-3 inline-flex text-[11px] font-semibold text-indigo-700 hover:text-indigo-900">{linkLabel}</a> : null}</div>;
}

function formatSessionExpiry(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
  } catch {
    return date.toISOString();
  }
}

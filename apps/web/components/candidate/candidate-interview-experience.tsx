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
import { getDefaultLocale } from "../../lib/i18n";

export interface CandidateInterviewRuntime {
  connect(input: { stream: MediaStream; audioOnly: boolean }): Promise<void>;
  reconnect?(input: { stream: MediaStream; audioOnly: boolean }): Promise<void>;
  disconnect?(): Promise<void>;
}

export interface CandidateInterviewExperienceProps {
  candidateName: string;
  jobTitle: string;
  sessionExpiresAt: string;
  runtime?: CandidateInterviewRuntime;
}

type MediaRequestMode = "full" | "audio-only";
const secondaryButton = "min-h-11 rounded-xl border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40";

function permissionFromBrowser(value: PermissionState): CandidateMediaPermissionState {
  return value === "granted" || value === "denied" || value === "prompt" ? value : "unknown";
}

async function readPermission(name: "microphone" | "camera"): Promise<CandidateMediaPermissionState> {
  if (!navigator.permissions?.query) return "unknown";
  try {
    return permissionFromBrowser((await navigator.permissions.query({ name: name as PermissionName })).state);
  } catch {
    return "unknown";
  }
}

function mediaFailureCode(cause: unknown): "permission_denied" | "device_unavailable" {
  return cause instanceof DOMException && ["NotAllowedError", "SecurityError", "PermissionDeniedError"].includes(cause.name)
    ? "permission_denied"
    : "device_unavailable";
}

function connectionFailureCode(cause: unknown): "transport_timeout" | "transport_unavailable" | "unexpected" {
  if ((cause instanceof DOMException && ["TimeoutError", "AbortError"].includes(cause.name)) || (cause instanceof Error && /timeout/i.test(cause.name))) return "transport_timeout";
  return cause instanceof Error || cause instanceof DOMException ? "transport_unavailable" : "unexpected";
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

export function CandidateInterviewExperience({ candidateName, jobTitle, sessionExpiresAt, runtime }: CandidateInterviewExperienceProps) {
  const locale = getDefaultLocale();
  const copy = candidateInterviewUiCopy[locale];
  const [state, setState] = useState(() => createCandidateInterviewState({
    runtimeAvailable: Boolean(runtime),
    online: typeof navigator === "undefined" ? true : navigator.onLine,
  }));
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [hasLocalMedia, setHasLocalMedia] = useState(false);
  const [networkRestored, setNetworkRestored] = useState(false);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const reduce = (event: Parameters<typeof candidateInterviewReducer>[1]) => setState((current) => candidateInterviewReducer(current, event));
  const releaseStream = (updateUi = true) => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    if (updateUi) setHasLocalMedia(false);
  };
  const installStream = (stream: MediaStream) => {
    releaseStream(false);
    streamRef.current = stream;
    if (videoRef.current) videoRef.current.srcObject = stream;
    setHasLocalMedia(true);
    setMicrophoneEnabled(true);
    setCameraEnabled(stream.getVideoTracks().some((track) => track.readyState === "live"));
  };
  const inspectPermissions = async () => {
    const [microphone, camera] = await Promise.all([readPermission("microphone"), readPermission("camera")]);
    reduce({ type: "PERMISSIONS_RESOLVED", microphone, camera });
  };

  const requestMedia = async (mode: MediaRequestMode) => {
    setPermissionBusy(true);
    setNetworkRestored(false);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        reduce({ type: "PERMISSION_FAILED", code: "device_unavailable" });
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: mode === "full" });
      if (!stream.getAudioTracks().some((track) => track.readyState === "live")) {
        stream.getTracks().forEach((track) => track.stop());
        reduce({ type: "PERMISSION_FAILED", code: "device_unavailable" });
        return;
      }
      installStream(stream);
      reduce({
        type: "PERMISSIONS_RESOLVED",
        microphone: "granted",
        camera: mode === "audio-only" ? "unavailable" : stream.getVideoTracks().some((track) => track.readyState === "live") ? "granted" : "unavailable",
        audioOnly: mode === "audio-only",
      });
    } catch (cause) {
      releaseStream();
      const code = mediaFailureCode(cause);
      reduce({ type: "PERMISSION_FAILED", code });
      await inspectPermissions();
      reduce({ type: "PERMISSION_FAILED", code });
    } finally {
      setPermissionBusy(false);
    }
  };

  const attemptConnection = async (reconnect = false) => {
    if (!hasLocalMedia || !streamRef.current) return reduce({ type: "PERMISSION_FAILED", code: "device_unavailable" });
    if (state.network === "offline") return reduce({ type: "NETWORK_OFFLINE" });
    setConnectionBusy(true);
    reduce({ type: "CONNECT_REQUESTED" });
    try {
      if (!runtime) return;
      if (reconnect && runtime.reconnect) {
        await runtime.reconnect({ stream: streamRef.current, audioOnly: state.audioOnly });
        reduce({ type: "TRANSPORT_RECONNECTED" });
      } else {
        await runtime.connect({ stream: streamRef.current, audioOnly: state.audioOnly });
        reduce({ type: "CONNECTED" });
      }
    } catch (cause) {
      reduce({ type: "CONNECTION_FAILED", code: connectionFailureCode(cause) });
    } finally {
      setConnectionBusy(false);
    }
  };

  useEffect(() => {
    reduce({ type: "BOOTSTRAP", online: navigator.onLine, runtimeAvailable: Boolean(runtime) });
    void inspectPermissions();
    const onOffline = () => { setNetworkRestored(false); reduce({ type: "NETWORK_OFFLINE" }); };
    const onOnline = () => { setNetworkRestored(true); reduce({ type: "NETWORK_ONLINE" }); };
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      releaseStream(false);
      void runtime?.disconnect?.().catch(() => undefined);
    };
  }, [runtime]);

  useEffect(() => {
    const expiresAt = new Date(sessionExpiresAt).getTime();
    const verify = () => { if (Number.isFinite(expiresAt) && Date.now() >= expiresAt) reduce({ type: "SESSION_EXPIRED" }); };
    verify();
    const timer = window.setInterval(verify, 30_000);
    return () => window.clearInterval(timer);
  }, [sessionExpiresAt]);

  const permissionLabels: Record<CandidateMediaPermissionState, string> = {
    unknown: copy.permissions.unknown,
    prompt: copy.permissions.prompt,
    granted: copy.permissions.granted,
    denied: copy.permissions.denied,
    unavailable: copy.permissions.unavailable,
  };
  const errorMessages: Record<CandidateInterviewErrorCode, string> = copy.error;
  const fallbacks = candidateInterviewFallbacks(state);
  const permissionReady = mediaPermissionReady(state);
  const showAudioOnly = state.microphone === "granted" && !state.audioOnly && ["denied", "unavailable"].includes(state.camera);
  const canConnect = permissionReady && hasLocalMedia && state.network === "online" && !connectionBusy && !["fatal", "completed"].includes(state.phase);
  const toggleMicrophone = () => {
    const next = !microphoneEnabled;
    streamRef.current?.getAudioTracks().forEach((track) => { track.enabled = next; });
    setMicrophoneEnabled(next);
  };
  const toggleCamera = () => {
    const next = !cameraEnabled;
    streamRef.current?.getVideoTracks().forEach((track) => { track.enabled = next; });
    setCameraEnabled(next);
  };

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
          <div className="mt-5 flex flex-wrap justify-between gap-2 border-t border-slate-100 pt-4 text-xs text-slate-500">
            <strong className="font-semibold text-slate-800">{copy.secureSession}</strong>
            <span>{copy.sessionValidUntil}: {formatSessionExpiry(sessionExpiresAt, locale)}</span>
          </div>
        </header>

        {state.network === "offline" ? <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">{copy.network.offline}</div> : networkRestored ? <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{copy.network.restored}</div> : <div role="status" className="sr-only">{copy.network.online}</div>}

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="grid lg:grid-cols-[minmax(0,1.55fr)_minmax(300px,.75fr)]">
            <div className="p-4 sm:p-6">
              <div className="relative aspect-video overflow-hidden rounded-2xl bg-slate-950">
                <video ref={videoRef} autoPlay muted playsInline className={`h-full w-full object-cover ${cameraEnabled ? "" : "hidden"}`} />
                {!hasLocalMedia || !cameraEnabled ? <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-slate-900 to-slate-800 p-6 text-center text-white"><div><div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-white/10 text-xl">◉</div><div className="mt-4 text-sm font-semibold">{state.audioOnly ? copy.stage.audioOnly : copy.stage.localPreview}</div><p className="mt-2 max-w-md text-xs leading-5 text-slate-300">{state.audioOnly ? copy.stage.cameraOff : copy.stage.previewPrivate}</p></div></div> : null}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={toggleMicrophone} disabled={!hasLocalMedia} className={secondaryButton}>{microphoneEnabled ? copy.controls.microphoneOn : copy.controls.microphoneOff}</button>
                <button type="button" onClick={toggleCamera} disabled={!hasLocalMedia || state.audioOnly || !streamRef.current?.getVideoTracks().length} className={secondaryButton}>{cameraEnabled ? copy.controls.cameraOn : copy.controls.cameraOff}</button>
              </div>

              {state.error ? <div role="alert" className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${state.error.severity === "fatal" ? "border-rose-200 bg-rose-50 text-rose-900" : "border-amber-200 bg-amber-50 text-amber-950"}`}><div className="font-semibold">{errorMessages[state.error.code]}</div>{state.error.code === "permission_denied" ? <p className="mt-1 text-xs leading-5">{copy.permissions.deniedHelp}</p> : null}{state.error.code === "device_unavailable" ? <p className="mt-1 text-xs leading-5">{copy.permissions.unavailableHelp}</p> : null}{state.error.code === "runtime_unavailable" ? <p className="mt-1 text-xs leading-5">{copy.connection.runtimePreserved}</p> : null}{state.error.code === "reconnect_exhausted" ? <p className="mt-1 text-xs leading-5">{copy.connection.reconnectExhausted}</p> : null}</div> : null}

              <div className="mt-5 flex flex-wrap gap-2">
                <button type="button" disabled={permissionBusy || state.phase === "fatal" || state.phase === "completed"} onClick={() => void requestMedia("full")} className={secondaryButton}>{permissionBusy ? copy.permissions.checking : hasLocalMedia ? copy.permissions.retryBoth : copy.permissions.enableBoth}</button>
                {showAudioOnly ? <button type="button" disabled={permissionBusy} onClick={() => void requestMedia("audio-only")} className="min-h-11 rounded-xl border border-indigo-200 bg-indigo-50 px-4 text-xs font-semibold text-indigo-800 hover:bg-indigo-100">{copy.permissions.tryAudioOnly}</button> : null}
                <button type="button" disabled={!canConnect} onClick={() => void attemptConnection(state.phase === "reconnecting")} className="min-h-11 rounded-xl bg-slate-950 px-5 text-xs font-semibold text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300">{connectionBusy ? copy.stage.connecting : runtime ? copy.controls.start : copy.controls.checkRuntime}</button>
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
                <dl className="mt-3 space-y-2 text-xs"><StatusRow label={copy.connection.browser} value={state.network === "online" ? copy.connection.connected : copy.connection.notConnected} /><StatusRow label={copy.connection.devices} value={permissionReady && hasLocalMedia ? copy.permissions.granted : copy.permissions.unknown} /><StatusRow label={copy.connection.realtime} value={runtime ? copy.connection.available : copy.connection.pending} />{state.reconnectAttempts > 0 ? <StatusRow label={copy.connection.attempt} value={`${state.reconnectAttempts}/${state.maxReconnectAttempts}`} /> : null}</dl>
                {!runtime ? <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] leading-5 text-amber-900">{copy.connection.runtimePending}</div> : null}
              </section>

              {showAudioOnly || fallbacks.includes("resume_later") ? <section className="border-t border-slate-200 pt-5"><h2 className="text-sm font-semibold text-slate-900">{copy.fallback.title}</h2>{showAudioOnly ? <FallbackCard title={copy.fallback.audioOnlyTitle} body={copy.fallback.audioOnlyDescription} /> : null}{fallbacks.includes("resume_later") ? <FallbackCard title={copy.fallback.resumeTitle} body={copy.fallback.resumeDescription} linkLabel={copy.controls.backToSetup} /> : null}</section> : null}
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
  try { return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date); } catch { return date.toISOString(); }
}

"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "../product/icon";

type CandidateStage = "consent" | "device" | "introduction";
type DeviceState = "idle" | "checking" | "ready" | "error";
type ProbeResult = {
  stream: MediaStream | null;
  message: string;
};

const steps = [
  ["Invitation", "Verified invite", "complete"],
  ["Consent", "Recording and transcript disclosure", "consent"],
  ["Device check", "Camera, microphone and network", "device"],
  ["Introduction", "What to expect and how to ask for help", "introduction"],
  ["AI interview", "Structured job-relevant conversation", "future"],
  ["Technical task", "Only when this role requires it", "future"],
  ["Completion", "Next steps and candidate feedback", "future"],
] as const;

function stageIndex(stage: CandidateStage): number {
  return stage === "consent" ? 1 : stage === "device" ? 2 : 3;
}

function mediaErrorMessage(kind: "camera" | "microphone", error: unknown): string {
  const label = kind === "camera" ? "Camera" : "Microphone";
  if (!(error instanceof DOMException)) {
    return `${label} could not be started.`;
  }

  switch (error.name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return `${label} permission is blocked. Allow it for localhost in the browser site settings, then retry.`;
    case "NotFoundError":
    case "DevicesNotFoundError":
      return `No ${kind} device was detected by the browser.`;
    case "NotReadableError":
    case "TrackStartError":
      return `${label} was detected but could not start. Close apps that may be using it (Teams, Zoom, Camera, Meet), then retry.`;
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return `${label} is present but cannot satisfy the requested browser constraints.`;
    case "SecurityError":
      return `${label} access is blocked by the browser security context or policy.`;
    case "AbortError":
      return `${label} startup was interrupted. Retry the device check.`;
    default:
      return error.message ? `${label}: ${error.message}` : `${label} could not be started.`;
  }
}

async function probeDevice(kind: "camera" | "microphone"): Promise<ProbeResult> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia(
      kind === "camera" ? { video: true, audio: false } : { video: false, audio: true },
    );
    const live = (kind === "camera" ? stream.getVideoTracks() : stream.getAudioTracks()).some(
      (track) => track.readyState === "live",
    );
    if (!live) {
      stream.getTracks().forEach((track) => track.stop());
      return { stream: null, message: `${kind === "camera" ? "Camera" : "Microphone"} stream opened without a live track.` };
    }
    return { stream, message: `${kind === "camera" ? "Camera" : "Microphone"} is ready.` };
  } catch (error) {
    return { stream: null, message: mediaErrorMessage(kind, error) };
  }
}

export function CandidateInterviewExperience() {
  const [stage, setStage] = useState<CandidateStage>("consent");
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [deviceState, setDeviceState] = useState<DeviceState>("idle");
  const [deviceMessage, setDeviceMessage] = useState("Camera and microphone have not been checked yet.");
  const [cameraMessage, setCameraMessage] = useState("Not checked");
  const [microphoneMessage, setMicrophoneMessage] = useState("Not checked");
  const [hasCamera, setHasCamera] = useState(false);
  const [hasMicrophone, setHasMicrophone] = useState(false);
  const [cameraCount, setCameraCount] = useState<number | null>(null);
  const [microphoneCount, setMicrophoneCount] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function runDeviceCheck() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setDeviceState("error");
      setDeviceMessage("This browser does not expose the required media-device API.");
      return;
    }

    setDeviceState("checking");
    setDeviceMessage("Checking camera and microphone independently…");
    setCameraMessage("Checking…");
    setMicrophoneMessage("Checking…");
    setHasCamera(false);
    setHasMicrophone(false);

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setCameraCount(devices.filter((device) => device.kind === "videoinput").length);
      setMicrophoneCount(devices.filter((device) => device.kind === "audioinput").length);
    } catch {
      setCameraCount(null);
      setMicrophoneCount(null);
    }

    const [cameraResult, microphoneResult] = await Promise.all([
      probeDevice("camera"),
      probeDevice("microphone"),
    ]);

    const cameraReady = Boolean(cameraResult.stream);
    const microphoneReady = Boolean(microphoneResult.stream);
    setHasCamera(cameraReady);
    setHasMicrophone(microphoneReady);
    setCameraMessage(cameraResult.message);
    setMicrophoneMessage(microphoneResult.message);

    const tracks = [
      ...(cameraResult.stream?.getVideoTracks() ?? []),
      ...(microphoneResult.stream?.getAudioTracks() ?? []),
    ];
    const combinedStream = tracks.length > 0 ? new MediaStream(tracks) : null;
    streamRef.current = combinedStream;

    if (videoRef.current && cameraResult.stream) {
      videoRef.current.srcObject = new MediaStream(cameraResult.stream.getVideoTracks());
      await videoRef.current.play().catch(() => undefined);
    }

    if (cameraReady && microphoneReady) {
      setDeviceState("ready");
      setDeviceMessage("Camera and microphone are ready. The preview stays local to this browser session.");
      return;
    }

    setDeviceState("error");
    if (!cameraReady && microphoneReady) {
      setDeviceMessage("Microphone is ready, but the camera could not start. Resolve the camera issue below and retry.");
    } else if (cameraReady && !microphoneReady) {
      setDeviceMessage("Camera is ready, but the microphone could not start. Resolve the microphone issue below and retry.");
    } else {
      setDeviceMessage("Neither camera nor microphone could be started. Check browser permissions and whether another app is using the devices.");
    }
  }

  const currentStep = stageIndex(stage);

  return (
    <main lang="en" dir="ltr" className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 sm:px-6 lg:px-8 lg:py-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-[16px] border border-slate-200 bg-white px-5 py-4 shadow-[0_1px_2px_rgba(15,23,42,.03)]">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-[12px] bg-indigo-600 text-white"><Icon name="sparkles" size={17} /></div>
            <div><div className="text-[14px] font-semibold">AI Recruiter</div><div className="text-[11px] text-slate-500">Candidate interview experience</div></div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[10px]">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 font-medium text-slate-500">Secure invitation session</span>
            <span className="rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1.5 font-medium text-emerald-700">Invite verified</span>
          </div>
        </header>

        <div className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="self-start rounded-[16px] border border-slate-200 bg-white p-5 shadow-sm lg:sticky lg:top-6">
            <div className="text-[11px] font-semibold uppercase tracking-[.12em] text-slate-400">Your interview</div>
            <h1 className="mt-2 text-[24px] font-semibold tracking-tight">Senior Backend Engineer</h1>
            <p className="mt-2 text-[12px] leading-5 text-slate-500">Structured technical interview · Persian with technical English · approximately 45 minutes.</p>
            <div className="mt-5 grid grid-cols-2 gap-2 rounded-[11px] border border-slate-100 bg-slate-50 p-3 text-[10px]">
              <div><div className="text-slate-400">Format</div><div className="mt-1 font-semibold text-slate-700">AI technical</div></div>
              <div><div className="text-slate-400">Stage</div><div className="mt-1 font-semibold capitalize text-slate-700">{stage}</div></div>
            </div>
            <div className="mt-5 space-y-1">
              {steps.map(([label, note, key], index) => {
                const complete = index < currentStep || key === "complete";
                const current = key === stage;
                return (
                  <div key={label} className={`flex gap-3 rounded-[11px] p-3 ${current ? "bg-indigo-50 ring-1 ring-indigo-100" : ""}`}>
                    <div className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-semibold ${complete ? "bg-emerald-100 text-emerald-700" : current ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-500"}`}>{complete ? "✓" : index + 1}</div>
                    <div><div className={`text-[11px] font-semibold ${current ? "text-indigo-800" : "text-slate-800"}`}>{label}</div><div className="mt-0.5 text-[9px] leading-4 text-slate-400">{note}</div></div>
                  </div>
                );
              })}
            </div>
          </aside>

          <section className="rounded-[16px] border border-slate-200 bg-white p-6 shadow-sm sm:p-8 lg:p-9">
            {stage === "consent" ? (
              <>
                <div className="flex items-start gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[11px] bg-indigo-50 text-indigo-600"><Icon name="shield" size={17} /></div>
                  <div><div className="text-[11px] font-medium text-indigo-600">Consent & privacy</div><h2 className="mt-1 text-[26px] font-semibold tracking-tight">Before your interview starts</h2><p className="mt-2 max-w-2xl text-[12px] leading-6 text-slate-500">Understand what may be recorded, how transcript and evidence are used, what the AI interviewer can and cannot evaluate, and how to stop or ask for help.</p></div>
                </div>

                <div className="mt-7 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[12px] border border-slate-100 bg-slate-50 p-4"><div className="flex items-center gap-2 text-[11px] font-semibold"><Icon name="message" size={14} className="text-indigo-600" /> Transcript</div><p className="mt-2 text-[10px] leading-5 text-slate-500">Your answers may be transcribed so reviewers can inspect timestamped job-relevant evidence.</p></div>
                  <div className="rounded-[12px] border border-slate-100 bg-slate-50 p-4"><div className="flex items-center gap-2 text-[11px] font-semibold"><Icon name="interviews" size={14} className="text-indigo-600" /> Recording</div><p className="mt-2 text-[10px] leading-5 text-slate-500">Audio/video recording is used only when the interview policy permits it and your consent state allows it.</p></div>
                  <div className="rounded-[12px] border border-slate-100 bg-slate-50 p-4"><div className="flex items-center gap-2 text-[11px] font-semibold"><Icon name="target" size={14} className="text-indigo-600" /> Evaluation</div><p className="mt-2 text-[10px] leading-5 text-slate-500">Evaluation is based on job-relevant evidence and a versioned rubric. Final hiring decisions remain human-controlled.</p></div>
                  <div className="rounded-[12px] border border-slate-100 bg-slate-50 p-4"><div className="flex items-center gap-2 text-[11px] font-semibold"><Icon name="candidates" size={14} className="text-indigo-600" /> No biometric personality scoring</div><p className="mt-2 text-[10px] leading-5 text-slate-500">Face, body movement, gaze or accent are not used to infer honesty, personality, emotion, confidence or suitability.</p></div>
                </div>

                <div className="mt-6 rounded-[12px] border border-amber-100 bg-amber-50 p-4 text-[10px] leading-5 text-amber-800">Development candidate surface. Consent is interactive in the browser, but server-side consent persistence and real interview media remain release-gated.</div>

                <label className="mt-6 flex items-start gap-3 rounded-[12px] border border-slate-200 p-4 transition hover:bg-slate-50">
                  <input type="checkbox" checked={consentAccepted} onChange={(event) => setConsentAccepted(event.target.checked)} className="mt-0.5 h-4 w-4 accent-indigo-600" />
                  <span><span className="block text-[11px] font-semibold">I understand the interview, transcript and recording information above.</span><span className="mt-1 block text-[10px] leading-5 text-slate-500">Consent must be versioned and revocable according to organization policy and applicable rules.</span></span>
                </label>

                {privacyOpen ? (
                  <div className="mt-3 rounded-[12px] border border-slate-200 bg-slate-50 p-4 text-[10px] leading-5 text-slate-600">
                    Development privacy details: job-relevant transcript/evidence only, recording only with policy + consent, no face/body/accent suitability inference, and final hiring decisions remain human-controlled.
                  </div>
                ) : null}

                <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-5">
                  <button type="button" onClick={() => setPrivacyOpen((value) => !value)} className="text-[11px] font-semibold text-slate-500 hover:text-slate-800">{privacyOpen ? "Hide privacy details" : "Privacy details"}</button>
                  <button type="button" disabled={!consentAccepted} onClick={() => setStage("device")} className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-indigo-600 px-4 text-[11px] font-semibold text-white shadow-sm enabled:hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300">Continue to device check <Icon name="arrow" size={14} /></button>
                </div>
              </>
            ) : null}

            {stage === "device" ? (
              <>
                <div className="flex items-start gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[11px] bg-indigo-50 text-indigo-600"><Icon name="interviews" size={17} /></div>
                  <div><div className="text-[11px] font-medium text-indigo-600">Device check</div><h2 className="mt-1 text-[26px] font-semibold tracking-tight">Check camera and microphone</h2><p className="mt-2 max-w-2xl text-[12px] leading-6 text-slate-500">This check uses the browser media-device API on localhost. It probes camera and microphone independently and does not upload or persist the preview stream.</p></div>
                </div>

                <div className="mt-7 grid gap-4 lg:grid-cols-[1.2fr_.8fr]">
                  <div className="overflow-hidden rounded-[14px] border border-slate-200 bg-slate-950">
                    <video ref={videoRef} muted playsInline autoPlay className="aspect-video w-full object-cover" />
                  </div>
                  <div className="space-y-3">
                    <div className="rounded-[12px] border border-slate-100 p-4">
                      <div className="flex items-start justify-between gap-4 text-[11px]"><span>Camera{cameraCount !== null ? ` (${cameraCount} detected)` : ""}</span><span className={hasCamera ? "font-semibold text-emerald-600" : "text-slate-400"}>{hasCamera ? "Ready" : "Not ready"}</span></div>
                      <div className={`mt-1 text-[9px] leading-4 ${hasCamera ? "text-emerald-600" : "text-slate-500"}`}>{cameraMessage}</div>
                      <div className="mt-4 flex items-start justify-between gap-4 text-[11px]"><span>Microphone{microphoneCount !== null ? ` (${microphoneCount} detected)` : ""}</span><span className={hasMicrophone ? "font-semibold text-emerald-600" : "text-slate-400"}>{hasMicrophone ? "Ready" : "Not ready"}</span></div>
                      <div className={`mt-1 text-[9px] leading-4 ${hasMicrophone ? "text-emerald-600" : "text-slate-500"}`}>{microphoneMessage}</div>
                    </div>
                    <div className={`rounded-[12px] border p-4 text-[10px] leading-5 ${deviceState === "error" ? "border-rose-100 bg-rose-50 text-rose-700" : deviceState === "ready" ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-slate-100 bg-slate-50 text-slate-600"}`}>{deviceMessage}</div>
                    <button type="button" onClick={runDeviceCheck} disabled={deviceState === "checking"} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-[10px] border border-indigo-200 bg-white px-4 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-50 disabled:cursor-wait disabled:opacity-60"><Icon name="play" size={14} />{deviceState === "checking" ? "Checking devices…" : "Retry camera + microphone"}</button>
                    <div className="rounded-[10px] bg-slate-50 p-3 text-[9px] leading-4 text-slate-500">If Chrome reports “Could not start video source”, close Windows Camera, Teams, Zoom, Meet tabs, OBS or virtual-camera software, then retry. The browser console “unload” permission-policy warning is unrelated to camera startup.</div>
                  </div>
                </div>

                <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-5">
                  <button type="button" onClick={() => setStage("consent")} className="text-[11px] font-semibold text-slate-500 hover:text-slate-800">Back to consent</button>
                  <button type="button" disabled={deviceState !== "ready"} onClick={() => setStage("introduction")} className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-indigo-600 px-4 text-[11px] font-semibold text-white shadow-sm enabled:hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300">Continue to introduction <Icon name="arrow" size={14} /></button>
                </div>
              </>
            ) : null}

            {stage === "introduction" ? (
              <>
                <div className="flex items-start gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[11px] bg-indigo-50 text-indigo-600"><Icon name="brain" size={17} /></div>
                  <div><div className="text-[11px] font-medium text-indigo-600">Introduction</div><h2 className="mt-1 text-[26px] font-semibold tracking-tight">You are ready for the interview introduction</h2><p className="mt-2 max-w-2xl text-[12px] leading-6 text-slate-500">The consent and browser device-check interactions are now functional. The realtime Interview Brain + LiveKit + STT/TTS/avatar loop is still an M4 implementation gap and is not represented as working.</p></div>
                </div>

                <div className="mt-7 rounded-[14px] border border-slate-200 bg-slate-50 p-5">
                  <div className="text-[12px] font-semibold text-slate-900">What happens next</div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-[11px] bg-white p-4 text-[10px] leading-5 text-slate-600">The interviewer explains the format, confirms you can ask for clarification/skip/help, then starts the versioned interview plan.</div>
                    <div className="rounded-[11px] bg-white p-4 text-[10px] leading-5 text-slate-600">Realtime speech, transcript checkpoints and digital-human media must be connected before the AI interview button can be enabled.</div>
                  </div>
                </div>

                <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-5">
                  <button type="button" onClick={() => setStage("device")} className="text-[11px] font-semibold text-slate-500 hover:text-slate-800">Back to device check</button>
                  <button type="button" disabled title="Realtime M4 interview runtime is not connected yet" className="inline-flex h-10 cursor-not-allowed items-center gap-2 rounded-[10px] bg-slate-300 px-4 text-[11px] font-semibold text-white">Start AI interview <Icon name="play" size={14} /></button>
                </div>
              </>
            ) : null}
          </section>
        </div>
      </div>
    </main>
  );
}

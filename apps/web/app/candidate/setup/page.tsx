"use client";

import { useEffect, useState } from "react";

type CandidateSession = {
  authenticated: true;
  candidate: { displayName: string };
  job: { title: string };
};

type DeviceState = "idle" | "checking" | "ready" | "failed";

export default function CandidateSetupPage() {
  const [session, setSession] = useState<CandidateSession | null>(null);
  const [deviceState, setDeviceState] = useState<DeviceState>("idle");
  const [deviceError, setDeviceError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/backend/v1/candidate-auth/session", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) {
          window.location.replace("/candidate/login");
          return;
        }
        if (!response.ok) throw new Error("Unable to load candidate session");
        setSession((await response.json()) as CandidateSession);
      })
      .catch((cause) => setDeviceError(cause instanceof Error ? cause.message : "Unable to load candidate session"));
  }, []);

  async function checkDevices() {
    setDeviceState("checking");
    setDeviceError(null);
    let stream: MediaStream | undefined;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera and microphone access are not supported by this browser");
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      const audioReady = stream.getAudioTracks().some((track) => track.readyState === "live");
      const videoReady = stream.getVideoTracks().some((track) => track.readyState === "live");
      if (!audioReady || !videoReady) throw new Error("Both microphone and camera must be available");
      setDeviceState("ready");
    } catch (cause) {
      setDeviceState("failed");
      setDeviceError(cause instanceof Error ? cause.message : "Device check failed");
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
    }
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-4 py-10">
      <section className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <div className="text-[11px] font-semibold uppercase tracking-[.16em] text-indigo-600">Interview setup</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-.03em] text-slate-950">Prepare your device</h1>
        <p className="mt-2 text-sm text-slate-500">{session ? `${session.candidate.displayName} · ${session.job.title}` : "Loading your invitation…"}</p>

        <div className="mt-6 grid gap-3 md:grid-cols-3">
          {["Verified invitation", "Private candidate session", "Camera + microphone check"].map((item, index) => (
            <div key={item} className="rounded-xl border border-slate-100 bg-slate-50 p-4 text-xs text-slate-700">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[.08em] text-slate-400">Step {index + 1}</div>{item}
            </div>
          ))}
        </div>

        {deviceError ? <div className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{deviceError}</div> : null}
        <div className="mt-6 flex flex-wrap gap-3">
          <button disabled={!session || deviceState === "checking"} onClick={checkDevices} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-800 disabled:opacity-50" type="button">
            {deviceState === "checking" ? "Checking…" : deviceState === "ready" ? "Check again" : "Check camera and microphone"}
          </button>
          <button disabled={deviceState !== "ready"} onClick={() => window.location.assign("/candidate/interview")} className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40" type="button">
            Continue to interview
          </button>
        </div>
        <p className="mt-4 text-[11px] leading-5 text-slate-400">The device check only verifies browser access. It does not infer emotion, honesty, personality, or suitability from camera or microphone data.</p>
      </section>
    </main>
  );
}

"use client";

import type { components } from "@interview/api-client";
import { useEffect, useState } from "react";
import { api } from "../../../lib/api";

type CandidateSession = components["schemas"]["CandidateSessionDto"];
type CandidateConsentStatus = components["schemas"]["CandidateConsentStatusDto"];
type DeviceState = "idle" | "checking" | "ready" | "failed";
type ConsentType = "privacy_disclosure" | "ai_interview" | "recording";

const NOTICE_VERSION = "candidate-access-v1";
const REQUIRED_CONSENTS: Array<{ type: ConsentType; label: string; detail: string }> = [
  {
    type: "privacy_disclosure",
    label: "Privacy disclosure",
    detail: "I understand how interview data, evidence, and retention controls are used for this hiring process.",
  },
  {
    type: "ai_interview",
    label: "AI-assisted interview",
    detail: "I understand the interview may use AI for structured questioning and evidence support, while final hiring authority remains human.",
  },
  {
    type: "recording",
    label: "Audio/video recording",
    detail: "I consent to recording when the interview configuration enables it. Device checks alone are not recorded.",
  },
];

function messageFrom(value: unknown, fallback: string): string {
  if (value && typeof value === "object" && "message" in value) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string") return message;
    if (Array.isArray(message)) return message.map(String).join("; ");
  }
  return fallback;
}

export default function CandidateSetupPage() {
  const [session, setSession] = useState<CandidateSession | null>(null);
  const [consentStatus, setConsentStatus] = useState<CandidateConsentStatus | null>(null);
  const [consents, setConsents] = useState<Record<ConsentType, boolean>>({
    privacy_disclosure: false,
    ai_interview: false,
    recording: false,
  });
  const [deviceState, setDeviceState] = useState<DeviceState>("idle");
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [savingConsent, setSavingConsent] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([
      api.GET("/v1/candidate-auth/session"),
      api.GET("/v1/candidate-consent"),
    ])
      .then(([sessionResult, consentResult]) => {
        if (!active) return;
        if (sessionResult.error || !sessionResult.data) {
          window.location.replace("/candidate/login");
          return;
        }
        setSession(sessionResult.data);
        if (consentResult.error || !consentResult.data) {
          throw new Error(messageFrom(consentResult.error, "Unable to load consent status"));
        }
        setConsentStatus(consentResult.data);
        const granted = new Set(
          consentResult.data.latest.filter((receipt) => receipt.granted).map((receipt) => receipt.consentType),
        );
        setConsents({
          privacy_disclosure: granted.has("privacy_disclosure"),
          ai_interview: granted.has("ai_interview"),
          recording: granted.has("recording"),
        });
      })
      .catch((cause) => {
        if (active) setDeviceError(cause instanceof Error ? cause.message : "Unable to load candidate setup");
      });
    return () => {
      active = false;
    };
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

  async function persistConsentsAndContinue() {
    if (deviceState !== "ready" || !Object.values(consents).every(Boolean)) return;
    setSavingConsent(true);
    setDeviceError(null);
    try {
      for (const item of REQUIRED_CONSENTS) {
        const result = await api.POST("/v1/candidate-consent", {
          body: { consentType: item.type, noticeVersion: NOTICE_VERSION, granted: true },
        });
        if (result.error || !result.data) {
          throw new Error(messageFrom(result.error, `Unable to record ${item.label.toLowerCase()} consent`));
        }
      }
      const refreshed = await api.GET("/v1/candidate-consent");
      if (refreshed.error || !refreshed.data?.readyForInterview) {
        throw new Error(messageFrom(refreshed.error, "Required consent verification failed"));
      }
      window.location.assign("/candidate/interview");
    } catch (cause) {
      setDeviceError(cause instanceof Error ? cause.message : "Unable to save consent");
    } finally {
      setSavingConsent(false);
    }
  }

  const allConsentsGranted = Object.values(consents).every(Boolean);

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-4 py-10">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <div className="text-[11px] font-semibold uppercase tracking-[.16em] text-indigo-600">Interview setup</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-.03em] text-slate-950">Prepare your interview</h1>
        <p className="mt-2 text-sm text-slate-500">
          {session ? `${session.candidateDisplayName} · ${session.jobTitle}` : "Loading your secure invitation…"}
        </p>

        <div className="mt-6 grid gap-3 md:grid-cols-3">
          {["Verified invitation", "Consent & privacy", "Camera + microphone check"].map((item, index) => (
            <div key={item} className="rounded-xl border border-slate-100 bg-slate-50 p-4 text-xs text-slate-700">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[.08em] text-slate-400">Step {index + 1}</div>{item}
            </div>
          ))}
        </div>

        <fieldset className="mt-6 space-y-3" disabled={!session || savingConsent}>
          <legend className="text-sm font-semibold text-slate-900">Required consent</legend>
          <p className="text-[11px] leading-5 text-slate-500">Consent choices are stored as versioned receipts and can be reviewed as part of the candidate privacy record.</p>
          {REQUIRED_CONSENTS.map((item) => (
            <label key={item.type} className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-100 p-4 text-xs text-slate-700">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4"
                checked={consents[item.type]}
                onChange={(event) => setConsents((current) => ({ ...current, [item.type]: event.target.checked }))}
              />
              <span><span className="font-semibold text-slate-900">{item.label}</span><span className="mt-1 block leading-5 text-slate-500">{item.detail}</span></span>
            </label>
          ))}
        </fieldset>

        {consentStatus?.readyForInterview ? <div className="mt-4 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-700">Required consent receipts are already on file for this interview.</div> : null}
        {deviceError ? <div role="alert" className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{deviceError}</div> : null}

        <div className="mt-6 flex flex-wrap gap-3">
          <button disabled={!session || deviceState === "checking"} onClick={checkDevices} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-800 disabled:opacity-50" type="button">
            {deviceState === "checking" ? "Checking…" : deviceState === "ready" ? "Check again" : "Check camera and microphone"}
          </button>
          <button
            disabled={deviceState !== "ready" || !allConsentsGranted || savingConsent}
            onClick={() => void persistConsentsAndContinue()}
            className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
            type="button"
          >
            {savingConsent ? "Saving consent…" : "Continue to interview"}
          </button>
        </div>
        <p className="mt-4 text-[11px] leading-5 text-slate-400">The device check only verifies browser access and immediately stops the temporary media tracks. It does not infer emotion, honesty, personality, or suitability from camera or microphone data.</p>
      </section>
    </main>
  );
}

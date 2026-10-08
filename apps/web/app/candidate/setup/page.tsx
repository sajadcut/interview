"use client";

import type { components } from "@interview/api-client";
import { useEffect, useRef, useState } from "react";
import { CandidateDevicePreview } from "../../../lib/candidate-device-preview";
import { api, localizeApiMessage } from "../../../lib/api";
import { candidateCopy, getDefaultLocale } from "../../../lib/i18n";

type CandidateSession = components["schemas"]["CandidateSessionDto"];
type CandidateConsentStatus = components["schemas"]["CandidateConsentStatusDto"];
type DeviceState = "idle" | "checking" | "ready" | "failed";
type ConsentType = "privacy_disclosure" | "ai_interview" | "recording";

const NOTICE_VERSION = "candidate-access-v1";
const REQUIRED_CONSENTS: ConsentType[] = ["privacy_disclosure", "ai_interview", "recording"];

function messageFrom(value: unknown, fallback: string, locale: "fa" | "en"): string {
  if (value && typeof value === "object" && "message" in value) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string") return locale === "fa" ? localizeApiMessage(message) : message;
    if (Array.isArray(message)) return message.map((item) => locale === "fa" ? localizeApiMessage(String(item)) : String(item)).join(locale === "fa" ? "؛ " : "; ");
  }
  return fallback;
}

function deviceErrorMessage(
  cause: unknown,
  copy: {
    deviceNotFound: string;
    devicePermissionDenied: string;
    deviceUnsupported: string;
    deviceRequired: string;
    deviceFailed: string;
  },
): string {
  if (cause instanceof DOMException) {
    if (["NotFoundError", "DevicesNotFoundError", "OverconstrainedError"].includes(cause.name)) {
      return copy.deviceNotFound;
    }
    if (["NotAllowedError", "SecurityError", "PermissionDeniedError"].includes(cause.name)) {
      return copy.devicePermissionDenied;
    }
  }
  if (cause instanceof Error) {
    if (
      cause.message === copy.deviceUnsupported ||
      cause.message === copy.deviceRequired
    ) {
      return cause.message;
    }
  }
  return copy.deviceFailed;
}

export default function CandidateSetupPage() {
  const locale = getDefaultLocale();
  const copy = candidateCopy[locale].setup;
  const [session, setSession] = useState<CandidateSession | null>(null);
  const [consentStatus, setConsentStatus] = useState<CandidateConsentStatus | null>(null);
  const [consents, setConsents] = useState<Record<ConsentType, boolean>>({
    privacy_disclosure: false,
    ai_interview: false,
    recording: false,
  });
  const [deviceState, setDeviceState] = useState<DeviceState>("idle");
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [audioOnly, setAudioOnly] = useState(false);
  const [hasCamera, setHasCamera] = useState(false);
  const [cameraIssue, setCameraIssue] = useState<string | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewRef = useRef<CandidateDevicePreview | null>(null);
  const checkIdRef = useRef(0);
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
          throw new Error(messageFrom(consentResult.error, candidateCopy[locale].genericError, locale));
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
        if (active) setDeviceError(cause instanceof Error ? cause.message : candidateCopy[locale].genericError);
      });
    return () => {
      active = false;
    };
  }, [locale]);

  // Closing/reloading this page must release devices, including when the
  // permission dialog resolves after the component has unmounted.
  useEffect(() => {
    return () => {
      checkIdRef.current += 1;
      previewRef.current?.stop();
      if (previewVideoRef.current) previewVideoRef.current.srcObject = null;
    };
  }, []);

  function stopPreview() {
    checkIdRef.current += 1;
    previewRef.current?.stop();
    if (previewVideoRef.current) previewVideoRef.current.srcObject = null;
    setDeviceState("idle");
    setDeviceError(null);
    setCameraIssue(null);
    setAudioOnly(false);
    setHasCamera(false);
  }

  async function checkDevices() {
    const checkId = ++checkIdRef.current;
    setDeviceState("checking");
    setDeviceError(null);
    setCameraIssue(null);
    setHasCamera(false);
    setAudioOnly(false);
    if (previewVideoRef.current) previewVideoRef.current.srcObject = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error(copy.deviceUnsupported);
      if (!previewRef.current) previewRef.current = new CandidateDevicePreview(navigator.mediaDevices);
      const result = await previewRef.current.start();
      if (!result || checkId !== checkIdRef.current) return;

      if (result.camera && previewVideoRef.current) {
        const video = previewVideoRef.current;
        video.srcObject = result.camera;
        void video.play().catch(() => {
          if (checkId === checkIdRef.current && video.srcObject === result.camera) {
            setCameraIssue(copy.previewPlaybackFailed);
          }
        });
      }

      setHasCamera(Boolean(result.camera));
      setAudioOnly(!result.camera);
      if (result.cameraError) {
        const cause = result.cameraError;
        setCameraIssue(
          cause instanceof DOMException && ["NotFoundError", "DevicesNotFoundError", "OverconstrainedError"].includes(cause.name)
            ? copy.cameraNotFound
            : cause instanceof DOMException && ["NotAllowedError", "SecurityError", "PermissionDeniedError"].includes(cause.name)
              ? copy.cameraPermissionDenied
              : copy.cameraUnavailable,
        );
      }

      for (const track of result.microphone.getAudioTracks()) {
        track.addEventListener("ended", () => {
          if (checkId !== checkIdRef.current) return;
          stopPreview();
          setDeviceState("failed");
          setDeviceError(copy.deviceRequired);
        }, { once: true });
      }
      for (const track of result.camera?.getVideoTracks() ?? []) {
        track.addEventListener("ended", () => {
          if (checkId !== checkIdRef.current) return;
          if (previewVideoRef.current) previewVideoRef.current.srcObject = null;
          setHasCamera(false);
          setAudioOnly(true);
          setCameraIssue(copy.cameraDisconnected);
        }, { once: true });
      }
      setDeviceState("ready");
    } catch (cause) {
      if (checkId !== checkIdRef.current) return;
      previewRef.current?.stop();
      setDeviceState("failed");
      setDeviceError(
        cause instanceof Error && cause.message === "microphone_unavailable"
          ? copy.deviceRequired
          : deviceErrorMessage(cause, copy),
      );
    }
  }

  async function persistConsentsAndContinue() {
    if (deviceState !== "ready" || !Object.values(consents).every(Boolean)) return;
    setSavingConsent(true);
    setDeviceError(null);
    try {
      for (const consentType of REQUIRED_CONSENTS) {
        const result = await api.POST("/v1/candidate-consent", {
          body: { consentType, noticeVersion: NOTICE_VERSION, granted: true },
        });
        if (result.error || !result.data) {
          throw new Error(messageFrom(result.error, candidateCopy[locale].genericError, locale));
        }
      }
      const refreshed = await api.GET("/v1/candidate-consent");
      if (refreshed.error || !refreshed.data?.readyForInterview) {
        throw new Error(messageFrom(refreshed.error, candidateCopy[locale].genericError, locale));
      }
      // Release setup devices before the interview page acquires its own stream.
      previewRef.current?.stop();
      window.location.assign("/candidate/interview");
    } catch (cause) {
      setDeviceError(cause instanceof Error ? cause.message : candidateCopy[locale].genericError);
    } finally {
      setSavingConsent(false);
    }
  }

  const allConsentsGranted = Object.values(consents).every(Boolean);

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-4 py-8 sm:py-10">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <div className="text-[11px] font-semibold uppercase tracking-[.16em] text-indigo-600">{copy.eyebrow}</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-.03em] text-slate-950">{copy.title}</h1>
        <p className="mt-2 text-sm text-slate-500">
          {session ? `${session.candidateDisplayName} · ${session.jobTitle}` : copy.loading}
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {copy.steps.map((item, index) => (
            <div key={item} className="rounded-xl border border-slate-100 bg-slate-50 p-4 text-xs text-slate-700">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[.08em] text-slate-400">{index + 1}</div>{item}
            </div>
          ))}
        </div>

        <fieldset className="mt-6 space-y-3" disabled={!session || savingConsent}>
          <legend className="text-sm font-semibold text-slate-900">{copy.requiredConsent}</legend>
          <p className="text-[11px] leading-5 text-slate-500">{copy.consentNote}</p>
          {REQUIRED_CONSENTS.map((type) => {
            const [label, detail] = copy.consents[type];
            return (
              <label key={type} className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-100 p-4 text-xs text-slate-700">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4"
                  checked={consents[type]}
                  onChange={(event) => setConsents((current) => ({ ...current, [type]: event.target.checked }))}
                />
                <span><span className="font-semibold text-slate-900">{label}</span><span className="mt-1 block leading-5 text-slate-500">{detail}</span></span>
              </label>
            );
          })}
        </fieldset>

        {consentStatus?.readyForInterview ? <div className="mt-4 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{copy.consentReady}</div> : null}
        <section className="mt-5 grid gap-4 sm:grid-cols-[minmax(0,1fr)_220px]" aria-label={copy.previewTitle}>
          <div className="relative aspect-video overflow-hidden rounded-2xl bg-slate-950">
            <video ref={previewVideoRef} autoPlay muted playsInline className={`h-full w-full object-cover [transform:scaleX(-1)] ${hasCamera && deviceState === "ready" ? "" : "hidden"}`} />
            {!(hasCamera && deviceState === "ready") ? (
              <div className="absolute inset-0 grid place-items-center px-5 text-center text-sm leading-6 text-slate-200">
                {deviceState === "checking" ? copy.previewChecking : audioOnly && deviceState === "ready" ? copy.previewCameraOff : copy.previewIdle}
              </div>
            ) : null}
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700">
            <h2 className="font-semibold text-slate-900">{copy.previewTitle}</h2>
            <p className="mt-2 leading-5 text-slate-500">{copy.previewLocalOnly}</p>
            <div className="mt-4 space-y-2">
              <div className="flex justify-between gap-3"><span>{copy.microphoneLabel}</span><strong>{deviceState === "ready" ? copy.deviceReady : copy.deviceNotChecked}</strong></div>
              <div className="flex justify-between gap-3"><span>{copy.cameraLabel}</span><strong>{hasCamera && deviceState === "ready" ? copy.deviceReady : audioOnly && deviceState === "ready" ? copy.deviceUnavailable : copy.deviceNotChecked}</strong></div>
            </div>
          </div>
        </section>
        {audioOnly && deviceState === "ready" ? <div role="status" className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">{copy.audioOnlyReady}{cameraIssue ? ` ${cameraIssue}` : ""}</div> : null}
        {cameraIssue && !audioOnly ? <div role="alert" className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">{cameraIssue}</div> : null}
        {deviceError ? <div role="alert" className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{deviceError}</div> : null}

        <div className="mt-6 flex flex-wrap gap-3">
          <button disabled={!session || deviceState === "checking"} onClick={checkDevices} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-800 disabled:opacity-50" type="button">
            {deviceState === "checking" ? copy.checking : deviceState === "ready" ? copy.checkAgain : copy.checkDevices}
          </button>
          {deviceState === "ready" ? <button type="button" disabled={savingConsent} onClick={stopPreview} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-50">{copy.stopPreview}</button> : null}
          <button
            disabled={deviceState !== "ready" || !allConsentsGranted || savingConsent}
            onClick={() => void persistConsentsAndContinue()}
            className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
            type="button"
          >
            {savingConsent ? copy.saving : copy.continue}
          </button>
        </div>
        <p className="mt-4 text-[11px] leading-5 text-slate-400">{copy.deviceNote}</p>
      </section>
    </main>
  );
}

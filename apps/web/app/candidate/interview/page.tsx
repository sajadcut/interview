"use client";

import type { components } from "@interview/api-client";
import { useEffect, useState } from "react";
import { CandidateInterviewExperience } from "../../../components/candidate/candidate-interview-experience";
import { api } from "../../../lib/api";
import { candidateCopy, getDefaultLocale } from "../../../lib/i18n";

type CandidateSession = components["schemas"]["CandidateSessionDto"];

export default function CandidateInterviewPage() {
  const locale = getDefaultLocale();
  const copy = candidateCopy[locale];
  const [session, setSession] = useState<CandidateSession | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLoadError(false);
    void Promise.all([
      api.GET("/v1/candidate-auth/session"),
      api.GET("/v1/candidate-consent"),
    ])
      .then(([sessionResult, consentResult]) => {
        if (!active) return;
        if (sessionResult.error || !sessionResult.data) {
          if (sessionResult.response.status === 401) {
            window.location.replace("/candidate/login");
            return;
          }
          setLoadError(true);
          return;
        }
        if (consentResult.error || !consentResult.data) {
          if (consentResult.response.status === 401) {
            window.location.replace("/candidate/login");
            return;
          }
          setLoadError(true);
          return;
        }
        if (!consentResult.data.readyForInterview) {
          window.location.replace("/candidate/setup");
          return;
        }
        setSession(sessionResult.data);
      })
      .catch(() => {
        if (active) setLoadError(true);
      });
    return () => {
      active = false;
    };
  }, [loadAttempt]);

  if (loadError) {
    return (
      <main className="grid min-h-screen place-items-center px-4 py-10">
        <section role="alert" className="w-full max-w-md rounded-2xl border border-rose-200 bg-white p-6 text-center shadow-sm">
          <div className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-rose-50 font-semibold text-rose-700" aria-hidden="true">!</div>
          <h1 className="mt-4 text-lg font-semibold text-slate-950">{copy.genericError}</h1>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            {locale === "fa"
              ? "نشست امن شما حذف نشده است. اتصال شبکه را بررسی کنید و دوباره تلاش کنید."
              : "Your secure session has not been discarded. Check your network and try again."}
          </p>
          <button
            type="button"
            onClick={() => setLoadAttempt((value) => value + 1)}
            className="mt-5 min-h-11 rounded-xl bg-slate-950 px-5 text-xs font-semibold text-white hover:bg-slate-800"
          >
            {locale === "fa" ? "تلاش دوباره" : "Try again"}
          </button>
        </section>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="grid min-h-screen place-items-center px-4 text-sm text-slate-500" role="status" aria-live="polite">
        {copy.loading}
      </main>
    );
  }

  return (
    <CandidateInterviewExperience
      candidateName={session.candidateDisplayName}
      jobTitle={session.jobTitle}
      sessionExpiresAt={session.expiresAt}
      developmentPreview={process.env.NODE_ENV === "development"}
    />
  );
}

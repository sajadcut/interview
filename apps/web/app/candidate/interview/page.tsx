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
  const [error, setError] = useState<string | null>(null);

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
        if (consentResult.error || !consentResult.data?.readyForInterview) {
          window.location.replace("/candidate/setup");
          return;
        }
        setSession(sessionResult.data);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : copy.genericError);
      });
    return () => {
      active = false;
    };
  }, [copy.genericError]);

  if (error) {
    return <main role="alert" className="grid min-h-screen place-items-center px-4 text-sm text-red-700">{error}</main>;
  }
  if (!session) {
    return <main className="grid min-h-screen place-items-center px-4 text-sm text-slate-500">{copy.loading}</main>;
  }

  return (
    <CandidateInterviewExperience
      candidateName={session.candidateDisplayName}
      jobTitle={session.jobTitle}
    />
  );
}

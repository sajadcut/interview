"use client";

import type { components } from "@interview/api-client";
import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { candidateCopy, getDefaultLocale } from "../../../lib/i18n";

type CandidateSession = components["schemas"]["CandidateSessionDto"];

export default function CandidateCompletedPage() {
  const locale = getDefaultLocale();
  const copy = candidateCopy[locale].completed;
  const [session, setSession] = useState<CandidateSession | null>(null);

  useEffect(() => {
    let active = true;
    void api.GET("/v1/candidate-auth/session").then((result) => {
      if (!active) return;
      if (result.error || !result.data) {
        window.location.replace("/candidate/login");
        return;
      }
      setSession(result.data);
    });
    return () => {
      active = false;
    };
  }, []);

  async function finish() {
    await api.POST("/v1/candidate-auth/logout");
    window.location.replace("/candidate/login");
  }

  const detail = session
    ? copy.detail.replace("{job}", session.jobTitle)
    : candidateCopy[locale].loading;

  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <section className="w-full max-w-[560px] rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm sm:p-8">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-emerald-50 text-xl text-emerald-700" aria-hidden="true">✓</div>
        <h1 className="mt-4 text-2xl font-semibold tracking-[-.03em] text-slate-950">{copy.title}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          {session ? `${session.candidateDisplayName}، ${detail}` : detail}
        </p>
        <p className="mt-3 text-xs leading-5 text-slate-400">{copy.review}</p>
        <button onClick={() => void finish()} className="mt-6 min-h-10 rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-slate-500" type="button">{copy.end}</button>
      </section>
    </main>
  );
}

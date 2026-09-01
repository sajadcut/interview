"use client";

import { useEffect, useState } from "react";
import { candidateCopy, getDefaultLocale } from "../../lib/i18n";

export interface CandidateInterviewExperienceProps {
  candidateName: string;
  jobTitle: string;
}

export function CandidateInterviewExperience({
  candidateName,
  jobTitle,
}: CandidateInterviewExperienceProps) {
  const copy = candidateCopy[getDefaultLocale()].interview;
  const [online, setOnline] = useState(true);
  const [reconnected, setReconnected] = useState(false);

  useEffect(() => {
    setOnline(navigator.onLine);
    const handleOffline = () => {
      setOnline(false);
      setReconnected(false);
    };
    const handleOnline = () => {
      setOnline(true);
      setReconnected(true);
    };
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  const networkMessage = online ? (reconnected ? copy.reconnected : copy.online) : copy.offline;

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-10">
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-6 sm:px-8">
          <div className="text-[11px] font-semibold uppercase tracking-[.16em] text-indigo-600">{copy.eyebrow}</div>
          <h1 className="mt-2 text-2xl font-semibold tracking-[-.03em] text-slate-950 sm:text-3xl">{copy.title}</h1>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            {copy.hello} {candidateName}. {copy.role}: <span className="font-semibold text-slate-700">{jobTitle}</span>
          </p>
        </div>

        <div className="grid gap-6 p-5 sm:p-8 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">{copy.instructionsTitle}</h2>
            <ol className="mt-4 space-y-3">
              {copy.instructions.map((instruction, index) => (
                <li key={instruction} className="flex gap-3 rounded-xl border border-slate-100 bg-slate-50 p-4 text-xs leading-5 text-slate-600">
                  <span aria-hidden="true" className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white font-semibold text-indigo-600 shadow-sm">{index + 1}</span>
                  <span>{instruction}</span>
                </li>
              ))}
            </ol>

            <div
              role={online ? "status" : "alert"}
              aria-live="polite"
              className={`mt-5 rounded-xl px-4 py-3 text-xs leading-5 ${online ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}
            >
              {networkMessage}
            </div>
          </div>

          <aside className="rounded-xl border border-indigo-100 bg-indigo-50 p-5 text-xs leading-5 text-indigo-950">
            <h2 className="font-semibold">{copy.gateTitle}</h2>
            <p className="mt-2 text-indigo-800">{copy.gateDescription}</p>
            <a
              href="/candidate/setup"
              className="mt-5 inline-flex min-h-10 w-full items-center justify-center rounded-xl border border-indigo-200 bg-white px-4 py-2.5 font-semibold text-indigo-800 hover:bg-indigo-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {copy.backToSetup}
            </a>
          </aside>
        </div>
      </section>
    </main>
  );
}

"use client";

import { useEffect, useState } from "react";

type SessionInfo = {
  candidate: { displayName: string };
  job: { title: string };
};

export default function CandidateCompletedPage() {
  const [session, setSession] = useState<SessionInfo | null>(null);

  useEffect(() => {
    void fetch("/api/backend/v1/candidate-auth/session", {
      credentials: "same-origin",
      cache: "no-store",
    }).then(async (response) => {
      if (!response.ok) {
        window.location.replace("/candidate/login");
        return;
      }
      setSession((await response.json()) as SessionInfo);
    });
  }, []);

  async function finish() {
    await fetch("/api/backend/v1/candidate-auth/logout", {
      method: "POST",
      credentials: "same-origin",
    });
    window.location.replace("/candidate/login");
  }

  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <section className="w-full max-w-[560px] rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-emerald-50 text-xl text-emerald-700">✓</div>
        <h1 className="mt-4 text-2xl font-semibold tracking-[-.03em] text-slate-950">Interview completed</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          {session ? `${session.candidate.displayName}, your ${session.job.title} interview has been recorded as complete.` : "Loading completion details…"}
        </p>
        <p className="mt-3 text-xs leading-5 text-slate-400">Your responses will be reviewed using the job rubric and supporting evidence. Final hiring decisions remain subject to human review.</p>
        <button onClick={finish} className="mt-6 rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white" type="button">End secure session</button>
      </section>
    </main>
  );
}

"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";

export default function CandidateLoginPage() {
  const [token, setToken] = useState("");

  useEffect(() => {
    fetch("/api/backend/v1/candidate-auth/session", {
      credentials: "same-origin",
      cache: "no-store",
    }).then((response) => {
      if (response.ok) window.location.replace("/candidate/setup");
    }).catch(() => undefined);
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = token.trim();
    if (!value) return;
    window.location.assign(`/candidate/invitation?token=${encodeURIComponent(value)}`);
  }

  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <section className="w-full max-w-[460px] rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <div className="text-[11px] font-semibold uppercase tracking-[.16em] text-indigo-600">Candidate access</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-.03em] text-slate-950">Open your interview invitation</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">Candidate access is invitation-based. No reusable candidate password is created. Use the secure link sent for this application, then verify the one-time code.</p>

        <form className="mt-6 space-y-4" onSubmit={submit}>
          <label className="block text-xs font-medium text-slate-700">
            Invitation token
            <input
              autoComplete="off"
              className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 font-mono text-xs outline-none focus:border-indigo-400"
              minLength={32}
              value={token}
              onChange={(event) => setToken(event.target.value)}
              required
            />
          </label>
          <button className="w-full rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white" type="submit">Continue</button>
        </form>

        <p className="mt-5 text-[11px] leading-5 text-slate-400">For production use, candidates normally arrive here through the emailed magic link rather than entering a token manually.</p>
      </section>
    </main>
  );
}

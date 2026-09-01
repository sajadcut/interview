"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../../../lib/api";
import { candidateCopy, getDefaultLocale } from "../../../lib/i18n";

export default function CandidateLoginPage() {
  const [token, setToken] = useState("");
  const copy = candidateCopy[getDefaultLocale()].login;

  useEffect(() => {
    let active = true;
    void api.GET("/v1/candidate-auth/session").then((result) => {
      if (active && result.data) window.location.replace("/candidate/setup");
    }).catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = token.trim();
    if (!value) return;
    window.location.assign(`/candidate/invitation?token=${encodeURIComponent(value)}`);
  }

  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <section className="w-full max-w-[460px] rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7">
        <div className="text-[11px] font-semibold uppercase tracking-[.16em] text-indigo-600">{copy.eyebrow}</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-.03em] text-slate-950">{copy.title}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">{copy.description}</p>

        <form className="mt-6 space-y-4" onSubmit={submit}>
          <label className="block text-xs font-medium text-slate-700">
            {copy.token}
            <input
              autoComplete="off"
              className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 font-mono text-xs outline-none focus:border-indigo-400"
              minLength={32}
              value={token}
              onChange={(event) => setToken(event.target.value)}
              required
            />
          </label>
          <button className="w-full rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white" type="submit">{copy.continue}</button>
        </form>

        <p className="mt-5 text-[11px] leading-5 text-slate-400">{copy.note}</p>
      </section>
    </main>
  );
}

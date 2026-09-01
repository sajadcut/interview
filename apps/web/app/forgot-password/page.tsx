"use client";

import { FormEvent, useState } from "react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [developmentToken, setDevelopmentToken] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch("/api/backend/auth/password-reset/request", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const payload = (await response.json().catch(() => null)) as { developmentToken?: string } | null;
      if (payload?.developmentToken) setDevelopmentToken(payload.developmentToken);
      setDone(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-4 py-10">
      <section className="w-full max-w-[440px] rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <div className="text-[11px] font-semibold uppercase tracking-[.16em] text-indigo-600">Account recovery</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-.03em] text-slate-950">Reset your password</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">Enter your work email. The response is intentionally identical whether or not an account exists.</p>
        {done ? (
          <div className="mt-5 space-y-3">
            <div className="rounded-xl bg-emerald-50 p-3 text-xs text-emerald-700">If the account is eligible, a reset link will be delivered.</div>
            {developmentToken ? <a className="block rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800" href={`/reset-password?token=${encodeURIComponent(developmentToken)}`}>Development only: open reset link</a> : null}
            <a className="text-xs font-semibold text-indigo-600" href="/login">Return to sign in</a>
          </div>
        ) : (
          <form className="mt-5 space-y-4" onSubmit={submit}>
            <label className="block text-xs font-medium text-slate-700">Work email<input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400" /></label>
            <button disabled={busy} className="w-full rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50" type="submit">{busy ? "Submitting…" : "Request reset"}</button>
          </form>
        )}
      </section>
    </main>
  );
}

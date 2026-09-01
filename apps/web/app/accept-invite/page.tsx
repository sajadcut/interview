"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../../lib/api";

function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "message" in payload) {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === "string") return message;
    if (Array.isArray(message)) return message.map(String).join("; ");
  }
  return fallback;
}

function AcceptInviteContent() {
  const token = useSearchParams().get("token")?.trim() ?? "";
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!token) return setError("Invitation token is missing");
    setBusy(true);
    try {
      const result = await api.POST("/v1/organization-invitations/accept", {
        body: { token, displayName: displayName.trim(), password },
      });
      if (result.error || !result.data?.accepted) {
        throw new Error(errorMessage(result.error, "Invitation could not be accepted"));
      }
      setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Invitation could not be accepted");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-4 py-10">
      <section className="w-full max-w-[460px] rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <div className="text-[11px] font-semibold uppercase tracking-[.16em] text-indigo-600">Organization invitation</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-.03em] text-slate-950">Activate your internal account</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">This invitation grants organization-scoped access. Candidate access uses a separate identity flow.</p>
        {done ? (
          <div className="mt-5"><div className="rounded-xl bg-emerald-50 p-3 text-xs text-emerald-700">Invitation accepted. You can now sign in.</div><a className="mt-4 inline-block text-xs font-semibold text-indigo-600" href="/login">Continue to sign in</a></div>
        ) : (
          <form className="mt-5 space-y-4" onSubmit={submit}>
            <label className="block text-xs font-medium text-slate-700">Display name<input required minLength={1} maxLength={200} value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400" /></label>
            <label className="block text-xs font-medium text-slate-700">Password<input required type="password" autoComplete="new-password" minLength={12} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400" /></label>
            {error ? <div className="rounded-xl bg-red-50 p-3 text-xs text-red-700">{error}</div> : null}
            <button disabled={busy} className="w-full rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50" type="submit">{busy ? "Activating…" : "Activate account"}</button>
          </form>
        )}
      </section>
    </main>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={<main className="grid min-h-screen place-items-center bg-slate-50 px-4 py-10 text-sm text-slate-500">Loading invitation…</main>}>
      <AcceptInviteContent />
    </Suspense>
  );
}

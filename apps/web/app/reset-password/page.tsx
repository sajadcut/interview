"use client";

import { useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";
import { api } from "../../lib/api";

function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "message" in payload) {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === "string") return message;
    if (Array.isArray(message)) return message.map(String).join("; ");
  }
  return fallback;
}

export default function ResetPasswordPage() {
  const token = useSearchParams().get("token")?.trim() ?? "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!token) return setError("Reset token is missing");
    if (password !== confirmPassword) return setError("Passwords do not match");
    setBusy(true);
    try {
      const result = await api.POST("/auth/password-reset/complete", { body: { token, password } });
      if (result.error || !result.data?.reset) throw new Error(errorMessage(result.error, "Password reset failed"));
      setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Password reset failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-4 py-10">
      <section className="w-full max-w-[440px] rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <div className="text-[11px] font-semibold uppercase tracking-[.16em] text-indigo-600">Account recovery</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-.03em] text-slate-950">Choose a new password</h1>
        {done ? (
          <div className="mt-5"><div className="rounded-xl bg-emerald-50 p-3 text-xs text-emerald-700">Password changed. Existing sessions have been revoked.</div><a className="mt-4 inline-block text-xs font-semibold text-indigo-600" href="/login">Sign in</a></div>
        ) : (
          <form className="mt-5 space-y-4" onSubmit={submit}>
            <label className="block text-xs font-medium text-slate-700">New password<input type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400" /></label>
            <label className="block text-xs font-medium text-slate-700">Confirm password<input type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400" /></label>
            {error ? <div className="rounded-xl bg-red-50 p-3 text-xs text-red-700">{error}</div> : null}
            <button disabled={busy} className="w-full rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50" type="submit">{busy ? "Changing…" : "Change password"}</button>
          </form>
        )}
      </section>
    </main>
  );
}

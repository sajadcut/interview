"use client";

import { FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

type InvitationContext = {
  valid: true;
  maskedEmail: string;
  candidateDisplayName: string;
  jobTitle: string;
  expiresAt: string;
};

function readMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "message" in payload) {
    const value = (payload as { message?: unknown }).message;
    if (typeof value === "string") return value;
  }
  return fallback;
}

export default function CandidateInvitationPage() {
  const search = useSearchParams();
  const token = search.get("token")?.trim() ?? "";
  const [context, setContext] = useState<InvitationContext | null>(null);
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError("Invitation token is missing");
      return;
    }
    fetch("/api/backend/v1/candidate-auth/magic-link/validate", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(readMessage(payload, "Invitation is invalid or expired"));
        setContext(payload as InvitationContext);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Invitation validation failed"));
  }, [token]);

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/backend/v1/candidate-auth/otp/verify", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, otp: otp.trim() }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(readMessage(payload, "Verification failed"));
      window.location.assign("/candidate/setup");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Verification failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <section className="w-full max-w-[500px] rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <div className="text-[11px] font-semibold uppercase tracking-[.16em] text-indigo-600">Secure invitation</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-.03em] text-slate-950">Verify candidate access</h1>
        {context ? (
          <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-4 text-sm text-slate-700">
            <div className="font-semibold">{context.candidateDisplayName}</div>
            <div className="mt-1 text-xs text-slate-500">{context.jobTitle} · code sent to {context.maskedEmail}</div>
          </div>
        ) : null}
        {error ? <div className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div> : null}

        {context ? (
          <form className="mt-5 space-y-4" onSubmit={verify}>
            <label className="block text-xs font-medium text-slate-700">
              One-time verification code
              <input
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-center text-lg tracking-[.35em] outline-none focus:border-indigo-400"
                value={otp}
                onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))}
                required
              />
            </label>
            <button disabled={busy || otp.length !== 6} className="w-full rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50" type="submit">
              {busy ? "Verifying…" : "Verify and continue"}
            </button>
          </form>
        ) : null}
      </section>
    </main>
  );
}

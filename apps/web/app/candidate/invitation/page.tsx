"use client";

import type { components } from "@interview/api-client";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../../../lib/api";
import { candidateCopy, getDefaultLocale } from "../../../lib/i18n";

type InvitationContext = components["schemas"]["CandidateMagicLinkValidationDto"];

function readMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "message" in payload) {
    const value = (payload as { message?: unknown }).message;
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map(String).join("; ");
  }
  return fallback;
}

function CandidateInvitationContent() {
  const copy = candidateCopy[getDefaultLocale()].invitation;
  const search = useSearchParams();
  const token = search.get("token")?.trim() ?? "";
  const [context, setContext] = useState<InvitationContext | null>(null);
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!token) {
      setError(copy.missing);
      return () => {
        active = false;
      };
    }

    void api.POST("/v1/candidate-auth/magic-link/validate", { body: { token } })
      .then((result) => {
        if (!active) return;
        if (result.error || !result.data) {
          throw new Error(readMessage(result.error, copy.invalid));
        }
        setContext(result.data);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : copy.invalid);
      });

    return () => {
      active = false;
    };
  }, [copy.invalid, copy.missing, token]);

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.POST("/v1/candidate-auth/otp/verify", {
        body: { token, otp: otp.trim() },
      });
      if (result.error || !result.data?.authenticated) {
        throw new Error(readMessage(result.error, copy.invalid));
      }
      window.location.assign("/candidate/setup");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.invalid);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <section className="w-full max-w-[500px] rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7">
        <div className="text-[11px] font-semibold uppercase tracking-[.16em] text-indigo-600">{copy.eyebrow}</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-.03em] text-slate-950">{copy.title}</h1>
        {context ? (
          <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-4 text-sm text-slate-700">
            <div className="font-semibold">{context.candidateDisplayName}</div>
            <div className="mt-1 text-xs text-slate-500">{context.jobTitle} · {copy.codeSent} {context.maskedEmail}</div>
          </div>
        ) : null}
        {!context && !error ? <div className="mt-4 rounded-xl bg-slate-50 px-3 py-3 text-xs text-slate-500">{copy.validating}</div> : null}
        {error ? <div role="alert" className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div> : null}

        {context ? (
          <form className="mt-5 space-y-4" onSubmit={verify}>
            <label className="block text-xs font-medium text-slate-700">
              {copy.codeLabel}
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
              {busy ? copy.verifying : copy.verify}
            </button>
          </form>
        ) : null}
      </section>
    </main>
  );
}

export default function CandidateInvitationPage() {
  const copy = candidateCopy[getDefaultLocale()];
  return (
    <Suspense fallback={<main className="grid min-h-screen place-items-center px-4 py-10 text-sm text-slate-500">{copy.loading}</main>}>
      <CandidateInvitationContent />
    </Suspense>
  );
}

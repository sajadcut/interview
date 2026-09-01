"use client";

import { useState, type FormEvent } from "react";
import { rememberOrganizationId, type SessionOrganization } from "../../lib/tenant-client";

interface LoginResponse {
  user: { id: string; email: string; displayName: string | null };
  organizations: SessionOrganization[];
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/backend/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const payload = (await response.json().catch(() => ({}))) as LoginResponse & { message?: string };
      if (!response.ok) throw new Error(payload.message || "Sign in failed");
      const organizationId = payload.organizations?.[0]?.id;
      if (!organizationId) throw new Error("Your account does not have an active organization membership");
      rememberOrganizationId(organizationId);
      window.location.assign("/app");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-4 py-10">
      <section className="w-full max-w-[420px] rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <div className="mb-7">
          <div className="text-[11px] font-semibold uppercase tracking-[.16em] text-indigo-600">Interview Platform</div>
          <h1 className="mt-2 text-2xl font-semibold tracking-[-.03em] text-slate-950">Sign in to your organization</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">Internal access for recruiters, interviewers, hiring managers and organization administrators.</p>
        </div>

        <form className="space-y-4" onSubmit={submit}>
          <label className="block text-xs font-medium text-slate-700">
            Work email
            <input
              autoComplete="email"
              className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label className="block text-xs font-medium text-slate-700">
            Password
            <input
              autoComplete="current-password"
              className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              type="password"
              minLength={12}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {error ? <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
          <button
            className="w-full rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy}
            type="submit"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-5 text-[11px] leading-5 text-slate-400">Candidate access uses a separate invitation and verification flow; candidate credentials are not shared with this login.</p>
      </section>
    </main>
  );
}

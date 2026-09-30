"use client";

import { useState, type FormEvent } from "react";
import { api, localizeApiMessage } from "../../lib/api";
import { rememberOrganizationId } from "../../lib/tenant-client";

function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "message" in payload) {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === "string") return localizeApiMessage(message);
    if (Array.isArray(message)) return message.map((item) => localizeApiMessage(String(item))).join("؛ ");
  }
  return fallback;
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
      const result = await api.POST("/auth/login", { body: { email, password } });
      if (result.error || !result.data) throw new Error(errorMessage(result.error, "ورود ناموفق بود"));
      const organization = result.data.organizations[0];
      if (!organization) throw new Error("حساب شما عضویت فعال در هیچ سازمانی ندارد");
      rememberOrganizationId(organization.id);
      const interviewerOnly =
        organization.roles.includes("INTERVIEWER") &&
        !organization.roles.some((role) =>
          ["ORGANIZATION_ADMIN", "HR_MANAGER", "RECRUITER", "HIRING_MANAGER"].includes(role),
        );
      window.location.assign(interviewerOnly ? "/interviewer" : "/app");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ورود ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="persian-ui grid min-h-screen place-items-center bg-slate-50 px-4 py-10">
      <section className="w-full max-w-[420px] rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <div className="mb-7">
          <div className="text-[11px] font-semibold uppercase tracking-[.16em] text-indigo-600">سامانه جذب و استخدام هوشمند</div>
          <h1 className="mt-2 text-2xl font-semibold tracking-[-.03em] text-slate-950">ورود به پنل سازمان</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">ورود داخلی برای کارشناسان جذب، مصاحبه‌گران، مدیران استخدام و مدیران سازمان.</p>
        </div>

        <form className="space-y-4" onSubmit={submit}>
          <label className="block text-xs font-medium text-slate-700">ایمیل کاری<input autoComplete="email" className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label className="block text-xs font-medium text-slate-700">رمز عبور<input autoComplete="current-password" className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" type="password" minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          <div className="text-end"><a className="text-[11px] font-semibold text-indigo-600" href="/forgot-password">رمز عبور را فراموش کرده‌اید؟</a></div>
          {error ? <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
          <button className="w-full rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50" disabled={busy} type="submit">{busy ? "در حال ورود…" : "ورود"}</button>
        </form>

        <p className="mt-5 text-[11px] leading-5 text-slate-400">دسترسی کاندیدا از مسیر دعوت‌نامه و احراز هویت جداگانه انجام می‌شود و اطلاعات ورود آن با این پنل مشترک نیست.</p>
      </section>
    </main>
  );
}

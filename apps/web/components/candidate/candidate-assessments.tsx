"use client";

import type { components } from "@interview/api-client";
import { useEffect, useState } from "react";
import { api, localizeApiMessage } from "../../lib/api";
import { faDomainLabel } from "../../lib/i18n";
import { formatFaNumber } from "../../lib/fa-numbers";

type AssessmentSession = components["schemas"]["CandidateAssessmentSessionDto"];

function messageFrom(value: unknown, fallback: string): string {
  if (value && typeof value === "object" && "message" in value) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string") return localizeApiMessage(message);
    if (Array.isArray(message)) return message.map((item) => localizeApiMessage(String(item))).join("؛ ");
  }
  return fallback;
}

export function CandidateAssessments() {
  const [sessions, setSessions] = useState<AssessmentSession[]>([]);
  const [selected, setSelected] = useState<AssessmentSession>();
  const [sourceText, setSourceText] = useState("");
  const [language, setزبان] = useState("typescript");
  const [message, setMessage] = useState<string>();
  const [loading, setLoading] = useState(true);

  async function load() {
    const result = await api.GET("/v1/candidate/assessments");
    if (result.response.status === 401) {
      window.location.href = "/candidate/login";
      return;
    }
    if (result.error || !result.data) {
      throw new Error(messageFrom(result.error, "ارزیابی‌ها بارگذاری نشدند"));
    }
    setSessions(result.data.sessions);
  }

  useEffect(() => {
    let active = true;
    void load()
      .catch((reason: unknown) => {
        if (active) setMessage(reason instanceof Error ? reason.message : "بارگذاری ارزیابی‌ها ناموفق بود");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function start(session: AssessmentSession) {
    const result = await api.POST("/v1/candidate/assessments/{sessionId}/start", {
      params: { path: { sessionId: session.session_id } },
    });
    if (result.error) {
      setMessage(messageFrom(result.error, "شروع ارزیابی ممکن نشد"));
      return;
    }
    setSelected({ ...session, status: "in_progress" });
    setMessage("ارزیابی شروع شد. پاسخ شما فقط پس از ثبت نهایی ذخیره می‌شود.");
    await load();
  }

  async function submit() {
    if (!selected || !sourceText.trim()) return;
    const result = await api.POST("/v1/candidate/assessments/{sessionId}/submissions", {
      params: { path: { sessionId: selected.session_id } },
      body: { language, sourceText },
    });
    if (result.error) {
      setMessage(messageFrom(result.error, "ثبت پاسخ ناموفق بود"));
      return;
    }
    setSourceText("");
    setSelected(undefined);
    setMessage("پاسخ دریافت شد. کد کاندیدا داخل API اصلی اجرا نمی‌شود و برای اجرا به محیط ایزوله ارزیابی نیاز دارد.");
    await load();
  }

  if (loading) return <div className="grid min-h-screen place-items-center text-sm text-slate-500">در حال بارگذاری ارزیابی‌ها…</div>;

  return (
    <main className="mx-auto max-w-5xl p-5 sm:p-8">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-[.15em] text-indigo-600">ارزیابی کاندیدا</div>
        <h1 className="mt-2 text-2xl font-semibold text-slate-950">ارزیابی‌های فنی</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          فقط ارزیابی‌های تخصیص‌یافته به همین پرونده را تکمیل کنید. سیگنال‌های یکپارچگی صرفاً به‌عنوان زمینه به بررسی‌کنندگان نمایش داده می‌شوند و به‌تنهایی به معنی تخلف نیستند.
        </p>
        {message ? <div role="status" aria-live="polite" className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-xs text-indigo-800">{message}</div> : null}
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[.9fr_1.1fr]">
        <section className="space-y-3">
          {sessions.length ? sessions.map((session) => (
            <article key={session.session_id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div><h2 className="text-sm font-semibold text-slate-900">{session.title}</h2><p className="mt-1 text-xs text-slate-500">{session.job_title} · {faDomainLabel(session.assessment_type)}</p></div>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-600">{faDomainLabel(session.status)}</span>
              </div>
              <p className="mt-3 text-xs leading-5 text-slate-600">{session.instructions}</p>
              {session.time_limit_minutes ? <div className="mt-3 text-[11px] text-slate-500">مهلت: {formatFaNumber(session.time_limit_minutes)} دقیقه</div> : null}
              {session.result_status ? <div className="mt-3 rounded-lg bg-slate-50 p-3 text-[11px] text-slate-600">نتیجه: {faDomainLabel(session.result_status)}{session.normalized_score != null ? ` · ${formatFaNumber(session.normalized_score)}/۱۰۰` : ""} · بررسی: {faDomainLabel(session.review_state || "pending")}</div> : null}
              {session.status === "invited" ? <button type="button" onClick={() => void start(session)} className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white">شروع ارزیابی</button> : null}
              {session.status === "in_progress" ? <button type="button" onClick={() => setSelected(session)} className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white">ادامه</button> : null}
            </article>
          )) : <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">هیچ ارزیابی‌ای به این پرونده تخصیص داده نشده است.</div>}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold">ویرایشگر پاسخ</h2>
          {selected ? <><div className="mt-3 text-xs text-slate-500">{selected.title}</div><label className="mt-4 block text-xs font-semibold text-slate-600">زبان<select value={language} onChange={(event) => setزبان(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-xs"><option value="typescript">TypeScript</option><option value="javascript">JavaScript</option><option value="python">Python</option><option value="csharp">C#</option><option value="java">Java</option><option value="text">پاسخ متنی / طراحی</option></select></label><label className="mt-4 block text-xs font-semibold text-slate-600">پاسخ / کد<textarea value={sourceText} onChange={(event) => setSourceText(event.target.value)} className="mt-1 min-h-[360px] w-full rounded-xl border border-slate-200 p-4 font-mono text-xs leading-5" spellCheck={false} /></label><button type="button" disabled={!sourceText.trim()} onClick={() => void submit()} className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">ثبت پاسخ نهایی</button></> : <p className="mt-4 text-xs leading-5 text-slate-500">برای باز کردن ویرایشگر پاسخ، یک ارزیابی را شروع یا ادامه دهید.</p>}
        </section>
      </div>
    </main>
  );
}

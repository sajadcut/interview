"use client";

import type { components } from "@interview/api-client";
import { useEffect, useState } from "react";
import { api, apiErrorMessage } from "../../lib/api";
import { formatFaNumber } from "../../lib/fa-numbers";
import { tenantHeaders, type TenantIdentity } from "../../lib/tenant-client";
import { useInternalAccess } from "../product/internal-access";

type Document = components["schemas"]["QuestionBankDocumentDto"];
type Question = components["schemas"]["BankQuestionDto"];

export function QuestionVersionsPanel({ jobId, identity, documents }: {
  jobId: string;
  identity: TenantIdentity | null;
  documents: Document[];
}) {
  const access = useInternalAccess();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [documentId, setDocumentId] = useState("");
  const [questionText, setQuestionText] = useState("");
  const [sourceExcerpt, setSourceExcerpt] = useState("");
  const [skillKey, setSkillKey] = useState("");
  const [skills, setSkills] = useState<Array<{ skillKey: string; nameEn: string }>>([]);
  const [editingId, setEditingId] = useState("");
  const [reasonById, setReasonById] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [consentRemote, setConsentRemote] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setDocumentId(documents[0]?.id ?? "");
    setConsentRemote(false);
  }, [jobId, documents]);

  useEffect(() => {
    if (!identity || !jobId) {
      setQuestions([]);
      setSkills([]);
      return;
    }
    let active = true;
    void Promise.all([
      api.GET("/v1/question-bank/jobs/{jobId}/questions", {
        params: { path: { jobId } }, headers: tenantHeaders(identity),
      }),
      api.GET("/v1/jobs/{jobId}/skill-requirements", {
        params: { path: { jobId } }, headers: tenantHeaders(identity),
      }),
    ]).then(([q, s]) => {
      if (!active) return;
      if (q.error) setError(apiErrorMessage(q, "سؤال‌های نسخه‌دار دریافت نشدند"));
      else setQuestions(q.data ?? []);
      if (!s.error) setSkills((s.data ?? []).map(item => ({ skillKey: item.skillKey, nameEn: item.nameEn })));
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "خطای دریافت سؤال");
    });
    return () => { active = false; };
  }, [identity, jobId]);

  async function reload() {
    if (!identity || !jobId) return;
    const result = await api.GET("/v1/question-bank/jobs/{jobId}/questions", {
      params: { path: { jobId } }, headers: tenantHeaders(identity),
    });
    if (result.error) throw new Error(apiErrorMessage(result, "سؤال‌های جدید دریافت نشدند"));
    setQuestions(result.data ?? []);
  }

  function edit(item: Question) {
    setEditingId(item.id);
    setDocumentId(item.documentId);
    setQuestionText(item.questionText);
    setSourceExcerpt(item.sourceExcerpt);
    setSkillKey(item.skillKey ?? "");
    setError("");
    setNotice("");
  }

  function resetForm() {
    setEditingId("");
    setQuestionText("");
    setSourceExcerpt("");
    setSkillKey("");
  }

  async function generateProposals() {
    if (!identity || !jobId || !documentId || !access.can("job.edit") || !consentRemote) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api.POST("/v1/question-bank/jobs/{jobId}/questions/propose", {
        params: { path: { jobId } }, headers: tenantHeaders(identity),
        body: { documentId, consentToRemoteProcessing: true },
      });
      if (result.error) throw new Error(apiErrorMessage(result, "پیشنهاد سؤال با مدل ناموفق بود"));
      if (result.data?.status === "ok") {
        await reload();
        setNotice(`${formatFaNumber(result.data.persistedCount)} پیشنهاد جدید ثبت شد. تمام سؤال‌های مدل منتظر تأیید انسانی هستند و خودکار وارد مصاحبه نمی‌شوند.`);
      } else if (result.data?.status === "no_job_skills") {
        setError("ابتدا مهارت‌های مورد انتظار شغل را تعریف کنید.");
      } else {
        setError("مدل سازمانی آماده نیست یا خروجی معتبر نداد. سؤال‌های ثبت‌شده تغییری نکردند.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "خطای دریافت پیشنهاد سؤال");
    } finally { setBusy(false); setConsentRemote(false); }
  }

  async function save() {
    if (!identity || !jobId || !access.can("job.edit")) return;
    const source = documents.find(item => item.id === documentId);
    if (!source) { setError("سند مورد نظر را انتخاب کنید."); return; }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const body = { questionText: questionText.trim(), sourceExcerpt: sourceExcerpt.trim(),
        ...(skillKey ? { skillKey } : {}) };
      if (editingId) {
        const previous = questions.find(item => item.id === editingId);
        if (!previous) throw new Error("سؤال برای ویرایش یافت نشد");
        const result = await api.PUT("/v1/question-bank/jobs/{jobId}/questions/{questionId}", {
          params: { path: { jobId, questionId: editingId } },
          headers: tenantHeaders(identity), body: { ...body, expectedVersion: previous.version },
        });
        if (result.error) throw new Error(apiErrorMessage(result, "نسخه جدید سؤال ذخیره نشد"));
      } else {
        const result = await api.POST("/v1/question-bank/jobs/{jobId}/questions", {
          params: { path: { jobId } }, headers: tenantHeaders(identity),
          body: { ...body, documentId },
        });
        if (result.error) throw new Error(apiErrorMessage(result, "سؤال ثبت نشد"));
      }
      await reload();
      resetForm();
      setNotice("نسخه سؤال ثبت شد. تا زمان بررسی انسانی در مصاحبه استفاده نمی‌شود.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ذخیره سؤال ناموفق بود");
    } finally { setBusy(false); }
  }

  async function review(item: Question, decision: "approved" | "rejected") {
    if (!identity || !jobId || !access.can("job.edit")) return;
    const reason = (reasonById[item.id] ?? "").trim();
    if (reason.length < 8) { setError("برای بازبینی باید حداقل ۸ نویسه دلیل وارد شود."); return; }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api.PUT("/v1/question-bank/jobs/{jobId}/questions/{questionId}/review", {
        params: { path: { jobId, questionId: item.id } },
        headers: tenantHeaders(identity),
        body: { decision, expectedVersion: item.version, reason },
      });
      if (result.error) throw new Error(apiErrorMessage(result, "ثبت نتیجه بررسی ناموفق بود"));
      await reload();
      setNotice(decision === "approved"
        ? "این نسخه سؤال برای Snapshotهای بعدی تأیید شد؛ انتخاب‌های قبلی ثابت می‌مانند."
        : "نسخه سؤال رد شد و وارد Snapshot مصاحبه نمی‌شود.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "خطای بازبینی");
    } finally { setBusy(false); }
  }

  if (!jobId || !access.can("job.read")) return null;
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <h2 className="text-base font-bold text-slate-900">سؤال‌های ساختاریافته و نسخه‌دار</h2>
    <p className="mt-2 text-xs leading-6 text-slate-600">
      فقط سؤال‌های تأییدشده و متصل به مهارتِ موجود در شغل، در نسخه ثابت انتخاب بعدی ذخیره می‌شوند.
      نقل‌قول منبع باید عیناً در سند بارگذاری‌شده باشد؛ متن سند دستورالعمل مدل محسوب نمی‌شود.
    </p>
    {error ? <p role="alert" className="mt-3 text-xs text-rose-700">{error}</p> : null}
    {notice ? <p role="status" className="mt-3 text-xs text-indigo-700">{notice}</p> : null}
    {access.can("job.edit") && documents.length ? <div className="mt-4 space-y-3 rounded-xl bg-slate-50 p-4">
      <label className="block text-xs font-semibold">سند مرجع
        <select value={documentId} disabled={Boolean(editingId)} onChange={e => setDocumentId(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-xs">
          {documents.map(item => <option key={item.id} value={item.id}>{item.fileName}</option>)}
        </select>
      </label>
      <label className="block text-xs font-semibold">سؤال
        <textarea value={questionText} onChange={e => setQuestionText(e.target.value)} rows={2}
          className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-xs"/>
      </label>
      <label className="block text-xs font-semibold">نقل‌قول مستقیم از سند
        <textarea value={sourceExcerpt} onChange={e => setSourceExcerpt(e.target.value)} rows={2}
          className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-xs"/>
      </label>
      <label className="block text-xs font-semibold">مهارت هدف
        <select value={skillKey} onChange={e => setSkillKey(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-xs">
          <option value="">انتخاب مهارت (برای تأیید لازم است)</option>
          {skills.map(item => <option key={item.skillKey} value={item.skillKey}>{item.nameEn}</option>)}
        </select>
      </label>
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-6 text-amber-950">
        <label className="flex cursor-pointer items-start gap-2">
          <input type="checkbox" checked={consentRemote} onChange={e => setConsentRemote(e.target.checked)}
            className="mt-1" aria-label="اجازه ارسال متن سند به مدل سازمانی" />
          <span>اجازه می‌دهم حداکثر ۶۰۰۰ نویسه از متن همین سند برای پیشنهاد سؤال به مدل پیکربندی‌شده سازمان ارسال شود. هیچ پیشنهادی بدون بازبینی و تأیید انسانی وارد مصاحبه نمی‌شود.</span>
        </label>
        <button type="button" disabled={busy || !consentRemote || !documentId}
          onClick={() => void generateProposals()}
          className="mt-2 rounded-lg border border-amber-300 bg-white px-3 py-2 font-semibold disabled:opacity-50">
          {busy ? "در حال پردازش…" : "پیشنهاد سؤال با هوش مصنوعی"}
        </button>
      </div>
      <div className="flex gap-2">
        <button type="button" disabled={busy || questionText.trim().length < 12 || sourceExcerpt.trim().length < 12}
          onClick={() => void save()} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs text-white disabled:opacity-50">
          {editingId ? "ثبت نسخه جدید" : "ایجاد سؤال"}
        </button>
        {editingId ? <button type="button" onClick={resetForm}
          className="rounded-lg border border-slate-300 px-3 py-2 text-xs">لغو ویرایش</button> : null}
      </div>
    </div> : null}
    <div className="mt-4 space-y-3">
      {questions.length === 0 ? <p className="text-xs text-slate-500">هنوز سؤال ساختاریافته‌ای ثبت نشده است.</p> : null}
      {questions.map(item => <article key={item.id} className="rounded-xl border border-slate-200 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="font-semibold">{item.questionText}</span>
          <span className="text-slate-500">نسخه {formatFaNumber(item.version)} · {item.reviewState === "approved" ? "تأییدشده" :
            item.reviewState === "rejected" ? "ردشده" : "در انتظار بررسی"}</span>
        </div>
        <blockquote className="mt-2 border-s-2 border-indigo-200 ps-3 text-xs text-slate-600">{item.sourceExcerpt}</blockquote>
        <p className="mt-2 text-[11px] text-slate-500">
          {item.skillKey || "مهارت تعیین نشده"} · {item.origin === "llm_proposed" ? "پیشنهاد بررسی‌نشده مدل" : "ثبت دستی"}
        </p>
        {access.can("job.edit") ? <div className="mt-3 space-y-2">
          <button type="button" onClick={() => edit(item)} className="rounded-lg border px-3 py-1.5 text-xs">
            ویرایش و ایجاد نسخه جدید
          </button>
          {item.reviewState === "pending" ? <>
            <textarea aria-label={`دلیل بررسی سؤال ${item.id}`} value={reasonById[item.id] ?? ""}
              onChange={e => setReasonById(old => ({ ...old, [item.id]: e.target.value }))}
              placeholder="دلیل مستند تصمیم انسانی" rows={2}
              className="block w-full rounded-lg border border-slate-200 p-2 text-xs"/>
            <div className="flex gap-2">
              <button type="button" disabled={busy} onClick={() => void review(item, "approved")}
                className="rounded-lg border border-emerald-200 px-3 py-1.5 text-xs text-emerald-700">تأیید سؤال</button>
              <button type="button" disabled={busy} onClick={() => void review(item, "rejected")}
                className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs text-rose-700">رد سؤال</button>
            </div>
          </> : null}
        </div> : null}
      </article>)}
    </div>
  </section>;
}

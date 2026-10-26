"use client";

import type { components } from "@interview/api-client";
import Link from "next/link";
import { QuestionVersionsPanel } from "./question-versions-panel";
import { useEffect, useState } from "react";
import { api, apiErrorMessage } from "../../lib/api";
import { formatFaNumber } from "../../lib/fa-numbers";
import { resolveTenantIdentity, tenantHeaders, type TenantIdentity } from "../../lib/tenant-client";
import { useInternalAccess } from "../product/internal-access";

type Job = components["schemas"]["QuestionBankJobDto"];
type Document = components["schemas"]["QuestionBankDocumentDto"];

export function QuestionBankWorkspace() {
  const access = useInternalAccess();
  const [identity, setIdentity] = useState<TenantIdentity | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobId, setJobId] = useState("");
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const tenant = await resolveTenantIdentity();
        const result = await api.GET("/v1/question-bank/jobs", { headers: tenantHeaders(tenant) });
        if (result.error || !result.data) throw new Error(apiErrorMessage(result, "فهرست موقعیت‌ها بارگذاری نشد"));
        if (!active) return;
        setIdentity(tenant);
        setJobs(result.data);
        setJobId((current) => current || result.data[0]?.id || "");
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "خطای بارگذاری");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  async function loadDocuments(currentJobId: string, tenant: TenantIdentity) {
    const result = await api.GET("/v1/question-bank/jobs/{jobId}/documents", {
      headers: tenantHeaders(tenant),
      params: { path: { jobId: currentJobId } },
    });
    if (result.error || !result.data) throw new Error(apiErrorMessage(result, "مستندات بارگذاری نشد"));
    setDocuments(result.data);
  }

  useEffect(() => {
    if (!jobId || !identity) {
      setDocuments([]);
      return;
    }
    let cancelled = false;
    void api.GET("/v1/question-bank/jobs/{jobId}/documents", {
      headers: tenantHeaders(identity), params: { path: { jobId } },
    }).then((result) => {
      if (cancelled) return;
      if (result.error || !result.data) setError(apiErrorMessage(result, "مستندات بارگذاری نشد"));
      else { setDocuments(result.data); setError(""); }
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "خطای دریافت مستندات");
    });
    return () => { cancelled = true; };
  }, [identity, jobId]);

  async function upload(file: File) {
    if (!identity || !jobId || !access.can("job.edit")) return;
    if (!/\.(pdf|docx|txt)$/i.test(file.name) || file.size === 0 || file.size > 10 * 1024 * 1024) {
      setError("فقط فایل PDF، DOCX یا TXT با حجم حداکثر ۱۰ مگابایت قابل بارگذاری است.");
      return;
    }
    setUploading(true);
    setError("");
    setNotice("");
    try {
      const form = new FormData();
      form.append("file", file, file.name);
      const result = await api.POST("/v1/question-bank/jobs/{jobId}/documents", {
        params: { path: { jobId } },
        headers: tenantHeaders(identity),
        body: { file: file.name },
        bodySerializer: () => form,
      });
      if (result.error) throw new Error(apiErrorMessage(result, "بارگذاری سند ناموفق بود"));
      await loadDocuments(jobId, identity);
      setNotice("سند روی دیسک سرور ذخیره و متن آن استخراج شد؛ اکنون برای انتخاب در مصاحبه آماده است.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "خطای بارگذاری سند");
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="space-y-5" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-950">بانک سؤال</h1>
          <p className="mt-2 text-xs leading-6 text-slate-500">
            مستندات آموزشی یا سؤال‌های هر موقعیت شغلی را بارگذاری کنید. سپس در «مصاحبه‌ها» برای هر کاندیدا
            مشخص کنید مصاحبه‌گر هوشمند از کدام فایل‌ها سؤال بپرسد.
          </p>
        </div>
        <Link href="/app/interviews" className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-xs font-semibold text-indigo-700">
          انتخاب مستندات برای کاندیدا
        </Link>
      </div>
      {error ? <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">{error}</p> : null}
      {notice ? <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">{notice}</p> : null}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <label className="block max-w-xl text-xs font-semibold text-slate-700" htmlFor="question-bank-job">
          موقعیت شغلی
        </label>
        <select id="question-bank-job" value={jobId} onChange={(event) => { setJobId(event.target.value); setNotice(""); }}
          disabled={loading} className="mt-2 h-11 w-full max-w-xl rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-indigo-500">
          {jobs.length === 0 ? <option value="">{loading ? "در حال بارگذاری…" : "موقعیت شغلی وجود ندارد"}</option> : null}
          {jobs.map((job) => <option key={job.id} value={job.id}>{job.title}</option>)}
        </select>
        {jobId && access.can("job.edit") ? (
          <label className={`mt-5 flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-indigo-200 bg-indigo-50/50 p-5 text-center ${uploading ? "pointer-events-none opacity-50" : ""}`}>
            <span className="text-sm font-semibold text-indigo-800">{uploading ? "در حال استخراج و ذخیره‌سازی…" : "بارگذاری مستند جدید"}</span>
            <span className="text-xs text-slate-500">PDF، DOCX یا TXT • حداکثر ۱۰ مگابایت • فایل اصلی در ذخیره‌ساز خصوصی دیسک</span>
            <input type="file" className="sr-only" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
              disabled={uploading} aria-label="انتخاب فایل بانک سؤال" onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) void upload(file);
              }} />
          </label>
        ) : null}
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold">مستندات ثبت‌شده</h2>
          <span className="text-xs text-slate-500">{formatFaNumber(documents.length)} فایل</span>
        </div>
        {documents.length === 0 ? (
          <p className="mt-4 rounded-xl bg-slate-50 p-5 text-center text-xs text-slate-500">برای این موقعیت هنوز مستندی ثبت نشده است.</p>
        ) : (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {documents.map((doc) => (
              <article key={doc.id} className="min-w-0 rounded-xl border border-slate-200 p-4">
                <h3 className="break-all text-sm font-semibold text-slate-800">{doc.fileName}</h3>
                <div className="mt-2 text-[11px] text-slate-400">{formatFaNumber(Math.ceil(doc.sizeBytes / 1024))} کیلوبایت • {new Date(doc.createdAt).toLocaleDateString("fa-IR")}</div>
                <p className="mt-3 line-clamp-4 whitespace-pre-line text-xs leading-6 text-slate-600">{doc.preview || "متن استخراج شده است."}</p>
              </article>
            ))}
          </div>
        )}
      </div>
      <QuestionVersionsPanel jobId={jobId} identity={identity} documents={documents} />
      <p className="text-[11px] leading-6 text-slate-500">
        این اسناد فقط زمینه تولید سؤال هستند؛ امتیازدهی همچنان با معیارهای منتشرشدهٔ شغل انجام می‌شود.
        برای فایل‌های اسکن‌شدهٔ بدون متن، باید نسخه قابل استخراج ارائه شود.
      </p>
    </section>
  );
}

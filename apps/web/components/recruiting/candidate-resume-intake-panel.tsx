"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, apiErrorMessage } from "../../lib/api";
import { formatFaNumber, formatFaPercent } from "../../lib/fa-numbers";
import { resolveTenantIdentity, tenantHeaders, type TenantIdentity } from "../../lib/tenant-client";
import { useInternalAccess } from "../product/internal-access";
import { Panel, Pill } from "../product/recruiting-ui";

type JobMatch = {
  jobId: string;
  jobTitle: string;
  jobStatus: string;
  department?: string;
  location?: string;
  seniority?: string;
  matchScore: number;
  algorithmVersion: string;
  matchedRequirements: string[];
  missingMustHaveRequirements: string[];
  rubricPublished: boolean;
  applicationId?: string;
};

type IntakeResult = {
  candidateId: string;
  candidateDisplayName: string;
  reusedExistingCandidate: boolean;
  resume: {
    id: string;
    status: string;
    originalFilename: string;
    chunkCount: number;
    evidenceCount: number;
    structuredProfile: {
      email: string | null;
      currentRole: string | null;
      currentCompany: string | null;
      skills: Array<{ label: string }>;
    };
  };
  matches: JobMatch[];
  analysisJobId?: string;
};

type AiMatch = {
  jobId: string;
  fitSummary: string;
  strengths: string[];
  gaps: string[];
  confidence: number;
};

type AnalysisStatus = {
  analysisJobId: string;
  status: string;
  matches?: AiMatch[];
  errorMessage?: string;
};

const MAX_RESUME_BYTES = 10 * 1024 * 1024;
const ACCEPTED = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);

export function CandidateResumeIntakePanel({ onCandidateReady }: { onCandidateReady?: () => void | Promise<void> }) {
  const access = useInternalAccess();
  const inputRef = useRef<HTMLInputElement>(null);
  const [identity, setIdentity] = useState<TenantIdentity>();
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<IntakeResult>();
  const [analysis, setAnalysis] = useState<AnalysisStatus>();
  const [message, setMessage] = useState<string>();
  const [busyJobId, setBusyJobId] = useState<string>();

  useEffect(() => {
    let active = true;
    void resolveTenantIdentity()
      .then((resolved) => {
        if (active) setIdentity(resolved);
      })
      .catch((cause) => {
        if (active) setMessage(cause instanceof Error ? cause.message : "سازمان فعال پیدا نشد");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!identity || !result?.analysisJobId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const analysisResult = await api.GET("/v1/candidate-intake/analyses/{analysisJobId}", {
          params: { path: { analysisJobId: result.analysisJobId! } },
          headers: tenantHeaders(identity),
        });
        if (analysisResult.error || !analysisResult.data) {
          throw new Error(apiErrorMessage(analysisResult, "وضعیت تحلیل هوش مصنوعی دریافت نشد"));
        }
        if (!active) return;
        const next = analysisResult.data as AnalysisStatus;
        setAnalysis(next);
        if (["queued", "running", "retry_scheduled"].includes(next.status)) {
          timer = setTimeout(() => void poll(), 2000);
        }
      } catch (cause) {
        if (active) setMessage(cause instanceof Error ? cause.message : "تحلیل هوش مصنوعی دریافت نشد");
      }
    };

    void poll();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [identity, result?.analysisJobId]);

  const aiByJob = useMemo(
    () => new Map((analysis?.matches ?? []).map((item) => [item.jobId, item])),
    [analysis?.matches],
  );

  async function upload(file: File) {
    if (!identity || !access.can("candidate.resume_manage")) return;
    if (file.size <= 0 || file.size > MAX_RESUME_BYTES) {
      setMessage("حجم رزومه باید بین ۱ بایت تا ۱۰ مگابایت باشد.");
      return;
    }
    if (!ACCEPTED.has(file.type)) {
      setMessage("فرمت رزومه باید PDF یا DOCX باشد.");
      return;
    }

    setUploading(true);
    setMessage(undefined);
    setResult(undefined);
    setAnalysis(undefined);
    try {
      const form = new FormData();
      form.append("file", file, file.name);
      const intakeResult = await api.POST("/v1/candidate-intake/resumes", {
        headers: tenantHeaders(identity),
        body: { file: file.name },
        bodySerializer: () => form,
      });
      if (intakeResult.error || !intakeResult.data) {
        throw new Error(apiErrorMessage(intakeResult, "پردازش رزومه ناموفق بود"));
      }
      const next = intakeResult.data as IntakeResult;
      setResult(next);
      setMessage(
        next.reusedExistingCandidate
          ? "رزومه به پروفایل موجود متصل شد و تطبیق موقعیت‌ها دوباره محاسبه شد."
          : "کاندیدا از روی رزومه ساخته شد و موقعیت‌های مناسب محاسبه شدند.",
      );
      if (inputRef.current) inputRef.current.value = "";
      await onCandidateReady?.();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "پردازش رزومه ناموفق بود");
    } finally {
      setUploading(false);
    }
  }

  async function acceptMatch(match: JobMatch) {
    if (!identity || !result) return;
    setBusyJobId(match.jobId);
    setMessage(undefined);
    try {
      const applicationResult = await api.POST(
        "/v1/candidate-intake/candidates/{candidateId}/job-matches/{jobId}/apply",
        {
          params: { path: { candidateId: result.candidateId, jobId: match.jobId } },
          headers: tenantHeaders(identity),
        },
      );
      if (applicationResult.error || !applicationResult.data) {
        throw new Error(apiErrorMessage(applicationResult, "افزودن کاندید به موقعیت ناموفق بود"));
      }
      const application = applicationResult.data as { applicationId: string };
      setResult((current) => current ? {
        ...current,
        matches: current.matches.map((item) =>
          item.jobId === match.jobId ? { ...item, applicationId: application.applicationId } : item,
        ),
      } : current);
      setMessage(`کاندید به موقعیت «${match.jobTitle}» اضافه شد.`);
      await onCandidateReady?.();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "افزودن کاندید به موقعیت ناموفق بود");
    } finally {
      setBusyJobId(undefined);
    }
  }

  if (!access.can("candidate.resume_manage")) return null;

  return (
    <Panel className="overflow-hidden">
      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div>
          <div className="text-[10px] font-semibold text-indigo-600">ورود رزومه‌محور کاندیدا</div>
          <h2 className="mt-1 text-[18px] font-semibold tracking-tight text-slate-950">
            رزومه را بارگذاری کنید؛ سیستم کاندیدا و موقعیت مناسب را پیدا می‌کند
          </h2>
          <p className="mt-2 max-w-2xl text-[10px] leading-5 text-slate-500">
            PDF یا Word استخراج می‌شود، مهارت‌ها و سوابق به شواهد قابل ردیابی تبدیل می‌شوند، سپس همه موقعیت‌های فعال با رزومه تطبیق داده می‌شوند. هوش مصنوعی دلیل تطبیق و شکاف‌ها را توضیح می‌دهد؛ تصمیم افزودن کاندید به موقعیت با منابع انسانی است.
          </p>

          <label className={`mt-5 flex min-h-32 cursor-pointer items-center justify-center rounded-2xl border border-dashed border-indigo-200 bg-indigo-50/40 p-5 text-center transition hover:bg-indigo-50 ${uploading ? "pointer-events-none opacity-60" : ""}`}>
            <div>
              <div className="text-[12px] font-semibold text-indigo-700">
                {uploading ? "در حال استخراج و تحلیل رزومه…" : "PDF یا DOCX را انتخاب کنید"}
              </div>
              <div className="mt-1 text-[9px] text-slate-500">حداکثر ۱۰ مگابایت · ساخت دستی کاندید لازم نیست</div>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="sr-only"
              disabled={uploading || !identity}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void upload(file);
              }}
            />
          </label>
        </div>

        <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
          <div className="text-[10px] font-semibold text-slate-700">خروجی پردازش</div>
          {result ? (
            <div className="mt-3 space-y-3">
              <div>
                <Link href={`/app/candidates/${result.candidateId}`} className="text-[13px] font-semibold text-slate-900 hover:text-indigo-600">
                  {result.candidateDisplayName}
                </Link>
                <div className="mt-1 text-[9px] text-slate-500">
                  {result.resume.structuredProfile.currentRole || "نقش فعلی استخراج نشده"}
                  {result.resume.structuredProfile.currentCompany ? ` · ${result.resume.structuredProfile.currentCompany}` : ""}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-white p-2"><div className="text-[8px] text-slate-400">مهارت</div><strong className="text-[12px]">{formatFaNumber(result.resume.structuredProfile.skills.length)}</strong></div>
                <div className="rounded-lg bg-white p-2"><div className="text-[8px] text-slate-400">شاهد</div><strong className="text-[12px]">{formatFaNumber(result.resume.evidenceCount)}</strong></div>
                <div className="rounded-lg bg-white p-2"><div className="text-[8px] text-slate-400">موقعیت</div><strong className="text-[12px]">{formatFaNumber(result.matches.length)}</strong></div>
              </div>
              {result.analysisJobId ? (
                <div className="rounded-lg bg-white px-3 py-2 text-[9px] text-slate-600">
                  تحلیل LLM: <strong>{analysis?.status === "succeeded" ? "آماده" : analysis?.status === "dead_letter" ? "ناموفق" : "در حال پردازش"}</strong>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="mt-3 text-[9px] leading-5 text-slate-400">پس از بارگذاری، خلاصه پروفایل و پیشنهاد موقعیت‌های مناسب اینجا نمایش داده می‌شود.</div>
          )}
        </div>
      </div>

      {message ? <div className="mx-5 mb-5 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-[10px] text-indigo-800">{message}</div> : null}

      {result ? (
        <div className="border-t border-slate-100 p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-[13px] font-semibold text-slate-900">پیشنهاد موقعیت‌های شغلی</h3>
              <p className="mt-1 text-[9px] text-slate-500">امتیاز از شواهد رزومه و Requirementهای موقعیت محاسبه می‌شود؛ LLM فقط توضیح قابل‌بررسی ارائه می‌کند.</p>
            </div>
            <Pill tone="blue">{formatFaNumber(result.matches.length)} موقعیت بررسی‌شده</Pill>
          </div>

          <div className="mt-4 grid gap-3 xl:grid-cols-2">
            {result.matches.slice(0, 8).map((match) => {
              const ai = aiByJob.get(match.jobId);
              return (
                <div key={match.jobId} className="rounded-2xl border border-slate-100 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Link href={`/app/jobs/${match.jobId}`} className="text-[12px] font-semibold text-slate-900 hover:text-indigo-600">{match.jobTitle}</Link>
                      <div className="mt-1 text-[9px] text-slate-400">{[match.department, match.seniority, match.location].filter(Boolean).join(" · ") || "اطلاعات تکمیلی ثبت نشده"}</div>
                    </div>
                    <div className="rounded-xl bg-indigo-50 px-3 py-2 text-center">
                      <div className="text-[8px] text-indigo-500">تطبیق</div>
                      <div className="text-[14px] font-semibold text-indigo-700">{formatFaPercent(match.matchScore)}</div>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <div className="rounded-lg bg-emerald-50 p-2.5">
                      <div className="text-[8px] font-semibold text-emerald-700">شواهد منطبق</div>
                      <div className="mt-1 text-[9px] leading-4 text-emerald-800">{match.matchedRequirements.length ? match.matchedRequirements.join("، ") : "مورد صریحی پیدا نشد"}</div>
                    </div>
                    <div className="rounded-lg bg-amber-50 p-2.5">
                      <div className="text-[8px] font-semibold text-amber-700">Must-have بدون شاهد کافی</div>
                      <div className="mt-1 text-[9px] leading-4 text-amber-800">{match.missingMustHaveRequirements.length ? match.missingMustHaveRequirements.join("، ") : "موردی نیست"}</div>
                    </div>
                  </div>

                  {ai ? (
                    <div className="mt-3 rounded-xl border border-violet-100 bg-violet-50/60 p-3">
                      <div className="text-[8px] font-semibold text-violet-700">تحلیل LLM · اطمینان {formatFaPercent(ai.confidence * 100)}</div>
                      <p className="mt-1 text-[9px] leading-5 text-slate-700">{ai.fitSummary}</p>
                      {ai.strengths.length ? <div className="mt-2 text-[8px] text-emerald-700">نقاط قوت: {ai.strengths.join(" · ")}</div> : null}
                      {ai.gaps.length ? <div className="mt-1 text-[8px] text-amber-700">شکاف‌ها: {ai.gaps.join(" · ")}</div> : null}
                    </div>
                  ) : result.analysisJobId ? (
                    <div className="mt-3 rounded-xl bg-slate-50 p-3 text-[8px] text-slate-500">تحلیل توضیحی LLM در حال آماده‌سازی است…</div>
                  ) : null}

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    {!match.rubricPublished ? <span className="text-[8px] text-amber-700">برای ساخت پرونده ابتدا Rubric این موقعیت را منتشر کنید.</span> : <span className="text-[8px] text-slate-400">تصمیم افزودن به موقعیت توسط HR ثبت می‌شود.</span>}
                    {match.applicationId ? (
                      <Link href={`/app/candidates/${result.candidateId}`} className="rounded-lg bg-emerald-50 px-3 py-2 text-[9px] font-semibold text-emerald-700">پرونده ساخته شده</Link>
                    ) : (
                      <button
                        type="button"
                        disabled={!match.rubricPublished || busyJobId === match.jobId}
                        onClick={() => void acceptMatch(match)}
                        className="rounded-lg bg-slate-950 px-3 py-2 text-[9px] font-semibold text-white disabled:opacity-40"
                      >
                        {busyJobId === match.jobId ? "در حال افزودن…" : "افزودن به این موقعیت"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {result.matches.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-slate-200 p-5 text-center text-[10px] text-slate-400">موقعیت فعال برای تطبیق وجود ندارد.</div>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}

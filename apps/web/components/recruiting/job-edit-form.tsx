"use client";

import type { components } from "@interview/api-client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api, apiErrorMessage } from "../../lib/api";
import { formatFaNumber } from "../../lib/fa-numbers";
import { faDomainLabel } from "../../lib/i18n";
import { resolveTenantIdentity, tenantHeaders, type TenantIdentity } from "../../lib/tenant-client";
import { useInternalAccess } from "../product/internal-access";
import { Panel, Pill } from "../product/recruiting-ui";

type JobWorkspace = components["schemas"]["JobWorkspaceDto"];
type Requirement = components["schemas"]["RequirementDto"];

function lines(value: string): string[] {
  return value.split("\n").map((line) => line.trim()).filter(Boolean);
}

function keyFor(value: string, index: number): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || `criterion_${index + 1}`;
}

function requirementMap(items: Requirement[]) {
  return new Map(items.map((item) => [
    `${item.requirementType}:${item.name.trim().toLowerCase()}`,
    item,
  ]));
}

export function JobEditForm({ jobId }: { jobId: string }) {
  const router = useRouter();
  const access = useInternalAccess();
  const [identity, setIdentity] = useState<TenantIdentity>();
  const [job, setJob] = useState<JobWorkspace>();
  const [title, setTitle] = useState("");
  const [department, setDepartment] = useState("");
  const [location, setLocation] = useState("");
  const [seniority, setSeniority] = useState("");
  const [summary, setSummary] = useState("");
  const [mustHave, setMustHave] = useState("");
  const [niceToHave, setNiceToHave] = useState("");
  const [criteriaText, setCriteriaText] = useState("");
  const [initialCriteriaText, setInitialCriteriaText] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<"save" | "publish">();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const resolved = await resolveTenantIdentity();
        const result = await api.GET("/v1/jobs/{jobId}/workspace", {
          params: { path: { jobId } },
          headers: tenantHeaders(resolved),
        });
        if (result.error || !result.data) {
          throw new Error(apiErrorMessage(result, "موقعیت شغلی بارگذاری نشد"));
        }
        if (!active) return;
        const loaded = result.data;
        const criterionLines = loaded.rubricCriteria.map((criterion) => criterion.label).join("\n");
        setIdentity(resolved);
        setJob(loaded);
        setTitle(loaded.title);
        setDepartment(loaded.department ?? "");
        setLocation(loaded.location ?? "");
        setSeniority(loaded.seniority ?? "");
        setSummary(loaded.summary ?? "");
        setMustHave(loaded.requirements.filter((item) => item.requirementType === "must_have").map((item) => item.name).join("\n"));
        setNiceToHave(loaded.requirements.filter((item) => item.requirementType === "nice_to_have").map((item) => item.name).join("\n"));
        setCriteriaText(criterionLines);
        setInitialCriteriaText(criterionLines);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "موقعیت شغلی بارگذاری نشد");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [jobId]);

  const requirements = useMemo(() => {
    const existing = requirementMap(job?.requirements ?? []);
    const build = (name: string, requirementType: "must_have" | "nice_to_have") => {
      const previous = existing.get(`${requirementType}:${name.toLowerCase()}`);
      return {
        name,
        requirementType,
        weight: previous?.weight ?? (requirementType === "must_have" ? 1 : 0.5),
        ...(previous?.description ? { description: previous.description } : {}),
        ...(previous?.minimumYears !== undefined ? { minimumYears: previous.minimumYears } : {}),
      };
    };
    return [
      ...lines(mustHave).map((name) => build(name, "must_have")),
      ...lines(niceToHave).map((name) => build(name, "nice_to_have")),
    ];
  }, [job?.requirements, mustHave, niceToHave]);

  const criteria = useMemo(() => {
    const existingByLabel = new Map(
      (job?.rubricCriteria ?? []).map((item) => [item.label.trim().toLowerCase(), item] as const),
    );
    return lines(criteriaText).map((label, index) => {
      const previous = existingByLabel.get(label.toLowerCase());
      return {
        criterionKey: previous?.criterionKey ?? keyFor(label, index),
        label,
        weight: previous?.weight ?? 1,
        required: previous?.required ?? true,
        displayOrder: index,
      };
    });
  }, [criteriaText, job?.rubricCriteria]);

  async function submit(mode: "save" | "publish") {
    if (!identity || !job || submitting) return;
    if (!title.trim()) {
      setError("عنوان موقعیت الزامی است.");
      return;
    }
    if (requirements.length === 0) {
      setError("حداقل یک نیازمندی شغلی وارد کنید.");
      return;
    }
    if (criteria.length === 0) {
      setError("حداقل یک معیار ارزیابی وارد کنید.");
      return;
    }

    setSubmitting(mode);
    setError(undefined);
    try {
      const headers = tenantHeaders(identity);
      const updated = await api.PATCH("/v1/jobs/{jobId}", {
        params: { path: { jobId } },
        headers,
        body: {
          title: title.trim(),
          ...(department.trim() ? { department: department.trim() } : {}),
          ...(location.trim() ? { location: location.trim() } : {}),
          ...(seniority.trim() ? { seniority: seniority.trim() } : {}),
          ...(summary.trim() ? { summary: summary.trim() } : {}),
          requirements,
        },
      });
      if (updated.error) {
        throw new Error(apiErrorMessage(updated, "ذخیره تغییرات موقعیت ناموفق بود"));
      }

      if (criteriaText.trim() !== initialCriteriaText.trim()) {
        const rubric = await api.PUT("/v1/jobs/{jobId}/rubric/draft", {
          params: { path: { jobId } },
          headers,
          body: {
            name: `${title.trim()} - چارچوب ارزیابی`,
            criteria,
          },
        });
        if (rubric.error) {
          throw new Error(apiErrorMessage(rubric, "ذخیره پیش‌نویس چارچوب ارزیابی ناموفق بود"));
        }
      }

      if (mode === "publish") {
        const published = await api.POST("/v1/jobs/{jobId}/publish", {
          params: { path: { jobId } },
          headers,
        });
        if (published.error) {
          throw new Error(apiErrorMessage(published, "انتشار موقعیت شغلی ناموفق بود"));
        }
      }

      router.push(`/app/jobs/${jobId}`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ذخیره تغییرات موقعیت ناموفق بود");
    } finally {
      setSubmitting(undefined);
    }
  }

  if (loading) return <div className="py-16 text-center text-sm text-slate-500">در حال بارگذاری موقعیت…</div>;
  if (!job) return <div className="rounded-xl border border-rose-100 bg-rose-50 p-5 text-sm text-rose-700">{error || "موقعیت شغلی پیدا نشد"}</div>;
  if (!access.can("job.edit")) return <div className="rounded-xl border border-amber-100 bg-amber-50 p-5 text-sm text-amber-800">نقش فعلی اجازه ویرایش موقعیت شغلی را ندارد.</div>;

  const field = "h-10 w-full rounded-[10px] border border-slate-200 bg-white px-3 text-[12px] outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100";
  const textarea = "w-full rounded-[10px] border border-slate-200 bg-white p-3 text-[12px] leading-6 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100";

  return (
    <div className="mx-auto max-w-[1180px] space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[10px] text-slate-400">موقعیت‌های شغلی / {job.title} / ویرایش</div>
          <div className="mt-2 flex items-center gap-2">
            <h1 className="text-[24px] font-semibold tracking-tight text-slate-950">ویرایش موقعیت شغلی</h1>
            <Pill tone={job.status === "open" ? "green" : "amber"}>{faDomainLabel(job.status)}</Pill>
          </div>
          <p className="mt-1 max-w-3xl text-[11px] leading-5 text-slate-500">
            اطلاعات موقعیت، نیازمندی‌ها و معیارهای ارزیابی را اصلاح کنید. پرونده‌های موجود به نسخه چارچوب ارزیابی خودشان متصل می‌مانند.
          </p>
        </div>
        <Link href={`/app/jobs/${jobId}`} className="rounded-[10px] border border-slate-200 bg-white px-4 py-2.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">
          بازگشت به موقعیت
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Panel className="space-y-4 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5 text-[10px] font-semibold text-slate-600">عنوان
              <input className={field} value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label className="space-y-1.5 text-[10px] font-semibold text-slate-600">دپارتمان
              <input className={field} value={department} onChange={(event) => setDepartment(event.target.value)} />
            </label>
            <label className="space-y-1.5 text-[10px] font-semibold text-slate-600">موقعیت
              <input className={field} value={location} onChange={(event) => setLocation(event.target.value)} />
            </label>
            <label className="space-y-1.5 text-[10px] font-semibold text-slate-600">سطح ارشدیت
              <input className={field} value={seniority} onChange={(event) => setSeniority(event.target.value)} />
            </label>
          </div>

          <label className="block space-y-1.5 text-[10px] font-semibold text-slate-600">خلاصه نقش
            <textarea className={`${textarea} min-h-28`} value={summary} onChange={(event) => setSummary(event.target.value)} />
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="block space-y-1.5 text-[10px] font-semibold text-slate-600">الزامات ضروری — هر خط یک مورد
              <textarea className={`${textarea} min-h-40`} value={mustHave} onChange={(event) => setMustHave(event.target.value)} />
            </label>
            <label className="block space-y-1.5 text-[10px] font-semibold text-slate-600">الزامات ترجیحی — هر خط یک مورد
              <textarea className={`${textarea} min-h-40`} value={niceToHave} onChange={(event) => setNiceToHave(event.target.value)} />
            </label>
          </div>

          <label className="block space-y-1.5 text-[10px] font-semibold text-slate-600">معیارهای ارزیابی — هر خط یک معیار
            <textarea className={`${textarea} min-h-44`} value={criteriaText} onChange={(event) => setCriteriaText(event.target.value)} />
            <span className="block text-[9px] font-normal text-slate-400">وزن و وضعیت اجباری معیارهای موجود تا زمانی که نامشان تغییر نکند حفظ می‌شود.</span>
          </label>
        </Panel>

        <Panel className="h-fit p-5">
          <h2 className="text-[13px] font-semibold text-slate-900">خلاصه تغییرات</h2>
          <div className="mt-4 grid grid-cols-2 gap-3 text-center">
            <div className="rounded-xl bg-slate-50 p-3"><div className="text-xl font-semibold">{formatFaNumber(requirements.length)}</div><div className="text-[9px] text-slate-500">نیازمندی</div></div>
            <div className="rounded-xl bg-slate-50 p-3"><div className="text-xl font-semibold">{formatFaNumber(criteria.length)}</div><div className="text-[9px] text-slate-500">معیار ارزیابی</div></div>
          </div>

          {job.status === "draft" ? (
            <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-[10px] leading-5 text-indigo-800">
              با «ذخیره و انتشار موقعیت»، آخرین چارچوب ارزیابی معتبر نیز منتشر می‌شود و وضعیت موقعیت از پیش‌نویس به باز تغییر می‌کند.
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-3 text-[10px] leading-5 text-slate-600">
              اگر معیارهای ارزیابی را تغییر دهید، یک نسخه پیش‌نویس جدید ساخته می‌شود و می‌توانید آن را از صفحه موقعیت منتشر کنید.
            </div>
          )}

          {error ? <div className="mt-4 rounded-xl border border-rose-100 bg-rose-50 p-3 text-[10px] leading-5 text-rose-700">{error}</div> : null}

          <div className="mt-5 space-y-2">
            <button type="button" onClick={() => void submit("save")} disabled={Boolean(submitting)} className="inline-flex h-10 w-full items-center justify-center rounded-[10px] border border-slate-200 bg-white text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              {submitting === "save" ? "در حال ذخیره…" : "ذخیره تغییرات"}
            </button>
            {["draft", "paused"].includes(job.status) ? (
              <button type="button" onClick={() => void submit("publish")} disabled={Boolean(submitting)} className="inline-flex h-10 w-full items-center justify-center rounded-[10px] bg-indigo-600 text-[11px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                {submitting === "publish" ? "در حال انتشار…" : job.status === "paused" ? "ذخیره و بازگشایی موقعیت" : "ذخیره و انتشار موقعیت"}
              </button>
            ) : null}
          </div>
        </Panel>
      </div>
    </div>
  );
}

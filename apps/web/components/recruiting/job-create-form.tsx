"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Panel } from "../product/recruiting-ui";
import { resolveTenantIdentity, tenantHeaders } from "../../lib/tenant-client";

interface DraftRequirement {
  name: string;
  requirementType: "must_have" | "nice_to_have";
  weight: number;
}

interface DraftCriterion {
  criterionKey: string;
  label: string;
  weight: number;
  required: boolean;
  displayOrder: number;
}

function lines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function keyFor(value: string, index: number): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || `criterion_${index + 1}`;
}

export function JobCreateForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [department, setDepartment] = useState("");
  const [location, setLocation] = useState("");
  const [seniority, setSeniority] = useState("");
  const [summary, setSummary] = useState("");
  const [mustHave, setMustHave] = useState("");
  const [niceToHave, setNiceToHave] = useState("");
  const [criteriaText, setCriteriaText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  const requirements = useMemo<DraftRequirement[]>(
    () => [
      ...lines(mustHave).map((name) => ({ name, requirementType: "must_have" as const, weight: 1 })),
      ...lines(niceToHave).map((name) => ({ name, requirementType: "nice_to_have" as const, weight: 0.5 })),
    ],
    [mustHave, niceToHave],
  );
  const criteria = useMemo<DraftCriterion[]>(
    () =>
      lines(criteriaText).map((label, index) => ({
        criterionKey: keyFor(label, index),
        label,
        weight: 1,
        required: true,
        displayOrder: index,
      })),
    [criteriaText],
  );

  async function submit() {
    if (!title.trim()) {
      setError("عنوان موقعیت الزامی است.");
      return;
    }
    if (criteria.length === 0) {
      setError("حداقل یک معیار ارزیابی وارد کنید.");
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      const identity = await resolveTenantIdentity();
      const response = await fetch("/api/backend/v1/jobs", {
        method: "POST",
        headers: tenantHeaders(identity, true),
        credentials: "same-origin",
        body: JSON.stringify({
          title: title.trim(),
          ...(department.trim() ? { department: department.trim() } : {}),
          ...(location.trim() ? { location: location.trim() } : {}),
          ...(seniority.trim() ? { seniority: seniority.trim() } : {}),
          ...(summary.trim() ? { summary: summary.trim() } : {}),
          requirements,
          rubricName: `${title.trim()} rubric`,
          rubricCriteria: criteria,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!response.ok || !payload.id) throw new Error(payload.message || "ایجاد موقعیت ناموفق بود");
      router.push(`/app/jobs/${payload.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ایجاد موقعیت ناموفق بود");
    } finally {
      setSubmitting(false);
    }
  }

  const field = "h-10 w-full rounded-[10px] border border-slate-200 bg-white px-3 text-[12px] outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100";
  const textarea = "w-full rounded-[10px] border border-slate-200 bg-white p-3 text-[12px] leading-6 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100";

  return (
    <div className="mx-auto max-w-[1180px] space-y-5">
      <div>
        <div className="text-[10px] text-slate-400">Jobs / Create</div>
        <h1 className="mt-2 text-[24px] font-semibold tracking-tight text-slate-950">Create a job and evidence rubric</h1>
        <p className="mt-1 max-w-3xl text-[11px] leading-5 text-slate-500">
          این فرم مستقیماً Job، Requirements و Rubric Version 1 را در دیتابیس ایجاد می‌کند. انتشار rubric یک اقدام جداگانه و قابل audit است.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Panel className="space-y-4 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5 text-[10px] font-semibold text-slate-600">عنوان
              <input className={field} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Senior Backend Engineer" />
            </label>
            <label className="space-y-1.5 text-[10px] font-semibold text-slate-600">دپارتمان
              <input className={field} value={department} onChange={(event) => setDepartment(event.target.value)} placeholder="Engineering" />
            </label>
            <label className="space-y-1.5 text-[10px] font-semibold text-slate-600">موقعیت
              <input className={field} value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Tehran / Hybrid" />
            </label>
            <label className="space-y-1.5 text-[10px] font-semibold text-slate-600">Senioritiy
              <input className={field} value={seniority} onChange={(event) => setSeniority(event.target.value)} placeholder="Senior" />
            </label>
          </div>
          <label className="block space-y-1.5 text-[10px] font-semibold text-slate-600">خلاصه نقش
            <textarea className={`${textarea} min-h-28`} value={summary} onChange={(event) => setSummary(event.target.value)} />
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block space-y-1.5 text-[10px] font-semibold text-slate-600">Must-have requirements — هر خط یک مورد
              <textarea className={`${textarea} min-h-36`} value={mustHave} onChange={(event) => setMustHave(event.target.value)} placeholder={"C#/.NET\nDistributed systems\nPostgreSQL"} />
            </label>
            <label className="block space-y-1.5 text-[10px] font-semibold text-slate-600">Nice-to-have requirements — هر خط یک مورد
              <textarea className={`${textarea} min-h-36`} value={niceToHave} onChange={(event) => setNiceToHave(event.target.value)} placeholder={"Azure\nKafka"} />
            </label>
          </div>
          <label className="block space-y-1.5 text-[10px] font-semibold text-slate-600">Rubric criteria — هر خط یک معیار
            <textarea className={`${textarea} min-h-40`} value={criteriaText} onChange={(event) => setCriteriaText(event.target.value)} placeholder={"System design\nBackend depth\nReliability reasoning\nCommunication"} />
          </label>
        </Panel>

        <Panel className="h-fit p-5">
          <h2 className="text-[13px] font-semibold text-slate-900">Draft summary</h2>
          <div className="mt-4 grid grid-cols-2 gap-3 text-center">
            <div className="rounded-xl bg-slate-50 p-3"><div className="text-xl font-semibold">{requirements.length}</div><div className="text-[9px] text-slate-500">requirements</div></div>
            <div className="rounded-xl bg-slate-50 p-3"><div className="text-xl font-semibold">{criteria.length}</div><div className="text-[9px] text-slate-500">criteria</div></div>
          </div>
          <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-[10px] leading-5 text-indigo-800">
            امتیاز نهایی تنها از rubric versioned و evidence-backed evaluation محاسبه می‌شود. ساخت Job هیچ Hiring Score مصنوعی تولید نمی‌کند.
          </div>
          {error ? <div className="mt-4 rounded-xl border border-rose-100 bg-rose-50 p-3 text-[10px] text-rose-700">{error}</div> : null}
          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting}
            className="mt-5 inline-flex h-10 w-full items-center justify-center rounded-[10px] bg-indigo-600 text-[11px] font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "در حال ایجاد…" : "Create draft job"}
          </button>
        </Panel>
      </div>
    </div>
  );
}

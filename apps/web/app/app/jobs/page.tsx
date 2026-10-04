"use client";

import type { components } from "@interview/api-client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "../../../components/product/icon";
import { Panel, Pill, ToolbarButton } from "../../../components/product/recruiting-ui";
import { useInternalAccess } from "../../../components/product/internal-access";
import { api } from "../../../lib/api";
import { formatFaNumber } from "../../../lib/fa-numbers";
import { faDomainLabel, formatFaDateTime } from "../../../lib/i18n";
import { resolveTenantIdentity, tenantHeaders } from "../../../lib/tenant-client";

type JobSummary = components["schemas"]["JobSummaryDto"];

function formatUpdatedAt(value: string): string {
  return formatFaDateTime(value);
}

export default function JobsPage() {
  const access = useInternalAccess();
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const identity = await resolveTenantIdentity();
        const result = await api.GET("/v1/jobs", { headers: tenantHeaders(identity) });
        if (result.error || !result.data) throw new Error("موقعیت‌های شغلی از سرویس جذب بارگذاری نشدند");
        if (active) setJobs(result.data);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "موقعیت‌های شغلی بارگذاری نشدند");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const filteredJobs = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return jobs;
    return jobs.filter((job) =>
      [job.title, job.department, job.location, job.seniority, job.status]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized)),
    );
  }, [jobs, query]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1 text-[11px] font-medium text-indigo-600">فضاهای کاری استخدام</div>
          <h1 className="text-[28px] font-semibold tracking-[-.03em] text-slate-950">موقعیت‌های شغلی</h1>
          <p className="mt-1.5 text-[12px] text-slate-500">موقعیت‌های استخدامی را ایجاد، پایش و مدیریت کنید.</p>
        </div>
        <Link href="/app/jobs/new">
          <ToolbarButton primary icon="plus">ایجاد موقعیت شغلی</ToolbarButton>
        </Link>
      </div>

      {error ? <div className="rounded-xl border border-rose-100 bg-rose-50 p-4 text-xs text-rose-700">{error}</div> : null}

      <Panel>
        <div className="border-b border-slate-200 p-4">
          <div className="relative min-w-[260px] flex-1">
            <Icon name="search" size={14} className="absolute start-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="h-10 w-full rounded-[10px] border border-slate-200 bg-slate-50 ps-10 pe-3 text-[11px] outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:bg-white focus:ring-4 focus:ring-indigo-50"
              placeholder="جست‌وجو بر اساس عنوان، تیم، محل یا وضعیت..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="data-table min-w-[920px]">
            <thead>
              <tr>
                {["موقعیت", "واحد", "محل", "کاندیداها", "مصاحبه‌ها", "وضعیت", "آخرین به‌روزرسانی", "عملیات"].map((heading) => (
                  <th key={heading}>{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="py-12 text-center text-slate-400">در حال بارگذاری موقعیت‌های شغلی…</td></tr>
              ) : filteredJobs.length === 0 ? (
                <tr><td colSpan={8} className="py-12 text-center text-slate-400">{jobs.length ? "موقعیتی با این جست‌وجو پیدا نشد." : "هنوز موقعیت شغلی برای این سازمان ایجاد نشده است."}</td></tr>
              ) : filteredJobs.map((job) => (
                <tr key={job.id}>
                  <td>
                    <Link className="font-semibold text-slate-900 hover:text-indigo-600" href={`/app/jobs/${job.id}`}>
                      {job.title}
                    </Link>
                    <div className="mt-1 text-[9px] text-slate-400">{job.seniority || "فضای کاری ساختاریافته استخدام"}</div>
                  </td>
                  <td>{job.department || "—"}</td>
                  <td>{job.location || "—"}</td>
                  <td className="font-semibold text-slate-700">{formatFaNumber(job.applicationCount)}</td>
                  <td className="font-semibold text-slate-700">{formatFaNumber(job.interviewCount)}</td>
                  <td><Pill tone={job.status.toLowerCase() === "open" ? "green" : "amber"}>{faDomainLabel(job.status)}</Pill></td>
                  <td className="whitespace-nowrap">{formatUpdatedAt(job.updatedAt)}</td>
                  <td className="whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <Link href={`/app/jobs/${job.id}`} className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-700">مدیریت</Link>
                      {access.can("job.edit") ? (
                        <Link href={`/app/jobs/${job.id}/edit`} className="text-[10px] font-semibold text-slate-600 hover:text-slate-900">ویرایش</Link>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-[10px] text-slate-400">
          <span>{formatFaNumber(filteredJobs.length)} از {formatFaNumber(jobs.length)} موقعیت ثبت‌شده</span>
          <span className="font-medium text-slate-500">مرتب‌شده بر اساس آخرین به‌روزرسانی</span>
        </div>
      </Panel>
    </div>
  );
}

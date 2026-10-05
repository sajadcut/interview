"use client";

import type { components } from "@interview/api-client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "../../../components/product/icon";
import { Panel, Pill, ToolbarButton } from "../../../components/product/recruiting-ui";
import { BulkActionBar, ConfirmDialog, InlineFeedback, SelectionCheckbox } from "../../../components/product/collection-management";
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
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteIds, setDeleteIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "success" | "warning" | "error"; text: string }>();
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
    return jobs.filter((job) => {
      if (statusFilter !== "all" && job.status !== statusFilter) return false;
      if (!normalized) return true;
      return [job.title, job.department, job.location, job.seniority, job.status]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized));
    });
  }, [jobs, query, statusFilter]);

  const selectedVisibleCount = filteredJobs.filter((job) => selectedIds.has(job.id)).length;
  const allVisibleSelected = filteredJobs.length > 0 && selectedVisibleCount === filteredJobs.length;
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected;

  function toggleJob(id: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAllVisible(checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const job of filteredJobs) {
        if (checked) next.add(job.id);
        else next.delete(job.id);
      }
      return next;
    });
  }

  async function confirmDelete() {
    if (deleteIds.length === 0 || deleting) return;
    setDeleting(true);
    setFeedback(undefined);
    try {
      const identity = await resolveTenantIdentity();
      const result = await api.POST("/v1/jobs/bulk-delete", {
        headers: tenantHeaders(identity),
        body: { ids: deleteIds },
      });
      if (result.error || !result.data) {
        throw new Error("حذف موقعیت‌های انتخاب‌شده ناموفق بود");
      }
      const deletedIds = new Set(result.data.deletedIds);
      setJobs((current) => current.filter((job) => !deletedIds.has(job.id)));
      setSelectedIds((current) => {
        const next = new Set(current);
        result.data.deletedIds.forEach((id) => next.delete(id));
        return next;
      });
      setFeedback(
        result.data.blockedIds.length
          ? { tone: "warning", text: `${formatFaNumber(result.data.deletedCount)} موقعیت حذف شد؛ ${formatFaNumber(result.data.blockedIds.length)} مورد به‌دلیل وابستگی یا وضعیت قابل حذف نبود.` }
          : { tone: "success", text: `${formatFaNumber(result.data.deletedCount)} موقعیت با موفقیت حذف شد.` },
      );
      setDeleteIds([]);
    } catch (cause) {
      setFeedback({ tone: "error", text: cause instanceof Error ? cause.message : "حذف موقعیت‌ها ناموفق بود" });
    } finally {
      setDeleting(false);
    }
  }

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
      {feedback ? <InlineFeedback tone={feedback.tone}>{feedback.text}</InlineFeedback> : null}

      <Panel>
        {selectedIds.size > 0 ? (
          <BulkActionBar selectedCount={selectedIds.size} noun="موقعیت" onClear={() => setSelectedIds(new Set())}>
            <button
              type="button"
              onClick={() => setDeleteIds([...selectedIds])}
              className="h-8 rounded-lg bg-rose-600 px-3 text-[10px] font-semibold text-white hover:bg-rose-700"
            >
              حذف انتخاب‌شده‌ها
            </button>
          </BulkActionBar>
        ) : (
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-4">
            <div className="relative min-w-[260px] flex-1">
              <Icon name="search" size={14} className="absolute start-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                className="h-10 w-full rounded-[10px] border border-slate-200 bg-slate-50 ps-10 pe-3 text-[11px] outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:bg-white focus:ring-4 focus:ring-indigo-50"
                placeholder="جست‌وجو بر اساس عنوان، تیم، محل یا وضعیت..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <select
              aria-label="فیلتر وضعیت موقعیت"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="h-10 rounded-[10px] border border-slate-200 bg-white px-3 text-[11px] text-slate-700 outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50"
            >
              <option value="all">همه وضعیت‌ها</option>
              <option value="draft">پیش‌نویس</option>
              <option value="open">باز</option>
              <option value="paused">متوقف</option>
              <option value="closed">بسته</option>
              <option value="archived">بایگانی‌شده</option>
            </select>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="data-table min-w-[920px]">
            <thead>
              <tr>
                <th className="w-10">
                  {access.can("job.edit") ? (
                    <SelectionCheckbox
                      label="انتخاب همه موقعیت‌های این فهرست"
                      checked={allVisibleSelected}
                      indeterminate={someVisibleSelected}
                      disabled={filteredJobs.length === 0}
                      onChange={toggleAllVisible}
                    />
                  ) : null}
                </th>
                {["موقعیت", "واحد", "محل", "کاندیداها", "مصاحبه‌ها", "وضعیت", "آخرین به‌روزرسانی", "عملیات"].map((heading) => (
                  <th key={heading}>{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="py-12 text-center text-slate-400">در حال بارگذاری موقعیت‌های شغلی…</td></tr>
              ) : filteredJobs.length === 0 ? (
                <tr><td colSpan={9} className="py-12 text-center text-slate-400">{jobs.length ? "موقعیتی با این جست‌وجو پیدا نشد." : "هنوز موقعیت شغلی برای این سازمان ایجاد نشده است."}</td></tr>
              ) : filteredJobs.map((job) => (
                <tr key={job.id}>
                  <td>
                    {access.can("job.edit") ? (
                      <SelectionCheckbox
                        label={`انتخاب ${job.title}`}
                        checked={selectedIds.has(job.id)}
                        onChange={(checked) => toggleJob(job.id, checked)}
                      />
                    ) : null}
                  </td>
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
                      {access.can("job.edit") ? (
                        <Link href={`/app/jobs/${job.id}/edit`} className="text-[10px] font-semibold text-slate-600 hover:text-slate-900">ویرایش</Link>
                      ) : null}
                      {access.can("job.edit") ? (
                        <button
                          type="button"
                          title={!job.deletable ? "حذف را امتحان کنید؛ اگر وضعیت یا وابستگی مانع باشد، دلیل دقیق نمایش داده می‌شود." : "حذف موقعیت"}
                          onClick={() => setDeleteIds([job.id])}
                          className="text-[10px] font-semibold text-rose-600 hover:text-rose-700"
                        >
                          حذف
                        </button>
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

      <ConfirmDialog
        open={deleteIds.length > 0}
        title={deleteIds.length > 1 ? "حذف موقعیت‌های انتخاب‌شده؟" : "حذف موقعیت شغلی؟"}
        description={
          deleteIds.length > 1
            ? `این کار ${formatFaNumber(deleteIds.length)} پیش‌نویس انتخاب‌شده را حذف می‌کند. فقط موقعیت‌های پیش‌نویس بدون کاندیدا و بدون درخواست جذب متصل قابل حذف‌اند.`
            : "این پیش‌نویس و نیازمندی‌ها و چارچوب ارزیابی وابسته به آن حذف می‌شوند. اگر پرونده یا درخواست جذب متصل باشد، حذف انجام نمی‌شود."
        }
        confirmLabel={deleteIds.length > 1 ? "حذف موقعیت‌ها" : "حذف موقعیت"}
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteIds([])}
      />
    </div>
  );
}

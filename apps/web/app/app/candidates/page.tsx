"use client";

import type { components } from "@interview/api-client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "../../../components/product/icon";
import { CandidateResumeIntakePanel } from "../../../components/recruiting/candidate-resume-intake-panel";
import { Panel, PersonAvatar, Pill, ToolbarButton } from "../../../components/product/recruiting-ui";
import { BulkActionBar, ConfirmDialog, InlineFeedback, SelectionCheckbox } from "../../../components/product/collection-management";
import { useInternalAccess } from "../../../components/product/internal-access";
import { api } from "../../../lib/api";
import { formatFaNumber } from "../../../lib/fa-numbers";
import { formatFaDateTime } from "../../../lib/i18n";
import { resolveTenantIdentity, tenantHeaders } from "../../../lib/tenant-client";

type CandidateSummary = components["schemas"]["CandidateSummaryDto"];

function formatUpdatedAt(value: string): string {
  return formatFaDateTime(value);
}

export default function CandidatesPage() {
  const access = useInternalAccess();
  const [candidates, setCandidates] = useState<CandidateSummary[]>([]);
  const [query, setQuery] = useState("");
  const [engagementFilter, setEngagementFilter] = useState<"all" | "active" | "unassigned">("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteIds, setDeleteIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "success" | "warning" | "error"; text: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const refreshCandidates = useCallback(async () => {
    const identity = await resolveTenantIdentity();
    const result = await api.GET("/v1/candidates", { headers: tenantHeaders(identity) });
    if (result.error || !result.data) throw new Error("کاندیداها از سرویس جذب بارگذاری نشدند");
    setCandidates(result.data);
  }, []);

  useEffect(() => {
    let active = true;
    void refreshCandidates()
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "کاندیداها بارگذاری نشدند");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refreshCandidates]);

  const filteredCandidates = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return candidates.filter((candidate) => {
      if (engagementFilter === "active" && candidate.applicationCount === 0) return false;
      if (engagementFilter === "unassigned" && candidate.applicationCount > 0) return false;
      if (!normalized) return true;
      return [candidate.displayName, candidate.currentRole, candidate.currentCompany, candidate.location, ...candidate.skills]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized));
    });
  }, [candidates, engagementFilter, query]);

  const selectedVisibleCount = filteredCandidates.filter((candidate) => selectedIds.has(candidate.id)).length;
  const allVisibleSelected = filteredCandidates.length > 0 && selectedVisibleCount === filteredCandidates.length;
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected;
  const selectedDeletableCount = candidates.filter(
    (candidate) => selectedIds.has(candidate.id) && candidate.applicationCount === 0,
  ).length;

  function toggleCandidate(id: string, checked: boolean) {
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
      for (const candidate of filteredCandidates) {
        if (checked) next.add(candidate.id);
        else next.delete(candidate.id);
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
      const result = await api.POST("/v1/candidates/bulk-delete", {
        headers: tenantHeaders(identity),
        body: { ids: deleteIds },
      });
      if (result.error || !result.data) throw new Error("حذف کاندیداهای انتخاب‌شده ناموفق بود");
      const deletedIds = new Set(result.data.deletedIds);
      setCandidates((current) => current.filter((candidate) => !deletedIds.has(candidate.id)));
      setSelectedIds((current) => {
        const next = new Set(current);
        result.data.deletedIds.forEach((id) => next.delete(id));
        return next;
      });
      setFeedback(
        result.data.blockedIds.length
          ? { tone: "warning", text: `${formatFaNumber(result.data.deletedCount)} کاندیدا حذف شد؛ ${formatFaNumber(result.data.blockedIds.length)} مورد به پرونده استخدامی متصل بود و حذف نشد.` }
          : { tone: "success", text: `${formatFaNumber(result.data.deletedCount)} کاندیدا با موفقیت حذف شد.` },
      );
      setDeleteIds([]);
    } catch (cause) {
      setFeedback({ tone: "error", text: cause instanceof Error ? cause.message : "حذف کاندیداها ناموفق بود" });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1 text-[11px] font-medium text-indigo-600">هوشمندی کاندیدا</div>
          <h1 className="text-[28px] font-semibold tracking-[-.03em] text-slate-950">کاندیداها</h1>
          <p className="mt-1.5 text-[12px] text-slate-500">پروفایل‌های کاندیدا در سطح سازمان و ارتباط آن‌ها با فرایندهای استخدام فعال.</p>
        </div>
        {access.can("candidate.resume_manage") ? (
          <Link href="/app/candidates/new">
            <ToolbarButton primary icon="plus">ایجاد کاندیدا</ToolbarButton>
          </Link>
        ) : null}
      </div>

      {error ? <div className="rounded-xl border border-rose-100 bg-rose-50 p-4 text-xs text-rose-700">{error}</div> : null}
      {feedback ? <InlineFeedback tone={feedback.tone}>{feedback.text}</InlineFeedback> : null}

      <CandidateResumeIntakePanel
        onCandidateReady={async () => {
          try {
            await refreshCandidates();
            setError(undefined);
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "کاندیداها دوباره بارگذاری نشدند");
          }
        }}
      />

      <Panel>
        {selectedIds.size > 0 ? (
          <BulkActionBar selectedCount={selectedIds.size} noun="کاندیدا" onClear={() => setSelectedIds(new Set())}>
            <button
              type="button"
              disabled={selectedDeletableCount === 0}
              title={selectedDeletableCount === 0 ? "کاندیداهای انتخاب‌شده به پرونده استخدامی متصل‌اند و حذف مستقیم آن‌ها مجاز نیست." : undefined}
              onClick={() => setDeleteIds([...selectedIds])}
              className="h-8 rounded-lg bg-rose-600 px-3 text-[10px] font-semibold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
            >
              حذف انتخاب‌شده‌ها
            </button>
          </BulkActionBar>
        ) : (
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-4">
            <div className="relative min-w-[280px] flex-1">
              <Icon name="search" size={14} className="absolute start-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                className="h-10 w-full rounded-[10px] border border-slate-200 bg-slate-50 ps-10 pe-3 text-[11px] outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:bg-white focus:ring-4 focus:ring-indigo-50"
                placeholder="جست‌وجو بر اساس نام، مهارت، شرکت، نقش یا محل..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <select
              aria-label="فیلتر وضعیت کاندیدا"
              value={engagementFilter}
              onChange={(event) => setEngagementFilter(event.target.value as "all" | "active" | "unassigned")}
              className="h-10 rounded-[10px] border border-slate-200 bg-white px-3 text-[11px] text-slate-700 outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50"
            >
              <option value="all">همه کاندیداها</option>
              <option value="active">دارای پرونده استخدامی</option>
              <option value="unassigned">بدون پرونده استخدامی</option>
            </select>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="data-table min-w-[980px]">
            <thead>
              <tr>
                <th className="w-10">
                  {access.can("candidate.resume_manage") ? (
                    <SelectionCheckbox
                      label="انتخاب همه کاندیداهای این فهرست"
                      checked={allVisibleSelected}
                      indeterminate={someVisibleSelected}
                      disabled={filteredCandidates.length === 0}
                      onChange={toggleAllVisible}
                    />
                  ) : null}
                </th>
                {["کاندیدا", "نقش فعلی", "شرکت", "مهارت‌ها", "محل", "آخرین به‌روزرسانی", "عملیات"].map((heading) => (
                  <th key={heading}>{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="py-12 text-center text-slate-400">در حال بارگذاری کاندیداها…</td></tr>
              ) : filteredCandidates.length === 0 ? (
                <tr><td colSpan={8} className="py-12 text-center text-slate-400">{candidates.length ? "کاندیدایی با این جست‌وجو پیدا نشد." : "هنوز کاندیدایی برای این سازمان ثبت نشده است."}</td></tr>
              ) : filteredCandidates.map((candidate, index) => (
                <tr key={candidate.id}>
                  <td>
                    {access.can("candidate.resume_manage") ? (
                      <SelectionCheckbox
                        label={`انتخاب ${candidate.displayName}`}
                        checked={selectedIds.has(candidate.id)}
                        onChange={(checked) => toggleCandidate(candidate.id, checked)}
                      />
                    ) : null}
                  </td>
                  <td>
                    <Link href={`/app/candidates/${candidate.id}`} className="flex items-center gap-3">
                      <PersonAvatar name={candidate.displayName} size={32} tone={index % 5} />
                      <div>
                        <div className="font-semibold text-slate-900">{candidate.displayName}</div>
                        <div className="mt-1 text-[9px] text-slate-400">پروفایل هوشمندی کاندیدا</div>
                      </div>
                    </Link>
                  </td>
                  <td className="font-medium text-slate-700">{candidate.currentRole || "—"}</td>
                  <td>{candidate.currentCompany || "—"}</td>
                  <td>
                    <div className="flex max-w-[300px] flex-wrap gap-1">
                      {candidate.skills.length ? candidate.skills.slice(0, 4).map((skill) => <Pill key={skill}>{skill}</Pill>) : <span className="text-slate-400">مهارتی ثبت نشده</span>}
                    </div>
                  </td>
                  <td>{candidate.location || "—"}</td>
                  <td className="whitespace-nowrap">{formatUpdatedAt(candidate.updatedAt)}</td>
                  <td className="whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      {access.can("candidate.resume_manage") ? (
                        <Link href={`/app/candidates/${candidate.id}/edit`} className="text-[10px] font-semibold text-slate-600 hover:text-slate-900">ویرایش</Link>
                      ) : null}
                      {access.can("candidate.resume_manage") ? (
                        <button
                          type="button"
                          disabled={candidate.applicationCount > 0}
                          title={candidate.applicationCount > 0 ? "این کاندیدا به پرونده استخدامی متصل است؛ برای حفظ سابقه و شواهد، حذف مستقیم مجاز نیست." : "حذف کاندیدا"}
                          onClick={() => setDeleteIds([candidate.id])}
                          className="text-[10px] font-semibold text-rose-600 hover:text-rose-700 disabled:cursor-not-allowed disabled:text-slate-300"
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

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 text-[10px] text-slate-400">
          <span>{formatFaNumber(filteredCandidates.length)} از {formatFaNumber(candidates.length)} کاندیدای ثبت‌شده</span>
          <span>تطبیق پیش از مصاحبه مختص هر پرونده استخدامی است و در فضای کاری موقعیت نمایش داده می‌شود.</span>
        </div>
      </Panel>

      <ConfirmDialog
        open={deleteIds.length > 0}
        title={deleteIds.length > 1 ? "حذف کاندیداهای انتخاب‌شده؟" : "حذف کاندیدا؟"}
        description={
          deleteIds.length > 1
            ? `این کار ${formatFaNumber(deleteIds.length)} پروفایل انتخاب‌شده را همراه با رزومه‌ها و شواهد مستقل آن‌ها حذف می‌کند. کاندیداهای دارای پرونده استخدامی حذف نمی‌شوند.`
            : "این پروفایل و رزومه‌ها و شواهد مستقل آن حذف می‌شوند. اگر کاندیدا به پرونده استخدامی متصل باشد، حذف انجام نمی‌شود."
        }
        confirmLabel={deleteIds.length > 1 ? "حذف کاندیداها" : "حذف کاندیدا"}
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteIds([])}
      />
    </div>
  );
}

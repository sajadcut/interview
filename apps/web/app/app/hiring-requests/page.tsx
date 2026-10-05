"use client";

import type { components } from "@interview/api-client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { BulkActionBar, ConfirmDialog, InlineFeedback, SelectionCheckbox } from "../../../components/product/collection-management";
import { Icon } from "../../../components/product/icon";
import { useInternalAccess } from "../../../components/product/internal-access";
import { Panel, Pill } from "../../../components/product/recruiting-ui";
import { api, apiErrorMessage } from "../../../lib/api";
import { formatFaNumber } from "../../../lib/fa-numbers";
import { faDomainLabel } from "../../../lib/i18n";
import { resolveTenantIdentity, tenantHeaders, type TenantIdentity } from "../../../lib/tenant-client";

type JobSummary = components["schemas"]["JobSummaryDto"];

interface HiringRequest {
  id: string;
  title: string;
  hiringTeam: string;
  department?: string;
  headcount: number;
  seniority?: string;
  location?: string;
  businessReason: string;
  requirements: string[];
  status: string;
  requesterUserId: string;
  requesterName: string;
  hrOwnerName?: string;
  linkedJobId?: string;
  linkedJobTitle?: string;
  reviewNote?: string;
  applicationCount: number;
  hiredCount: number;
  updatedAt: string;
}

const EMPTY_FORM = {
  title: "",
  hiringTeam: "",
  department: "",
  headcount: "1",
  seniority: "",
  location: "",
  businessReason: "",
  requirements: "",
};

function statusTone(status: string): "slate" | "green" | "blue" | "amber" | "red" {
  if (status === "approved" || status === "filled") return "green";
  if (status === "recruiting") return "blue";
  if (status === "submitted") return "amber";
  if (status === "rejected" || status === "cancelled") return "red";
  return "slate";
}

export default function HiringRequestsPage() {
  const access = useInternalAccess();
  const [identity, setIdentity] = useState<TenantIdentity>();
  const [items, setItems] = useState<HiringRequest[]>([]);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [selectedJobIds, setSelectedJobIds] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteIds, setDeleteIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [editingId, setEditingId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [feedback, setFeedback] = useState<{ tone: "success" | "warning" | "error"; text: string }>();
  const [busy, setBusy] = useState<string>();
  const [form, setForm] = useState(EMPTY_FORM);

  const load = useCallback(async (knownIdentity?: TenantIdentity) => {
    setLoading(true);
    setError(undefined);
    try {
      const currentIdentity = knownIdentity ?? identity ?? (await resolveTenantIdentity());
      if (!identity) setIdentity(currentIdentity);
      const headers = tenantHeaders(currentIdentity);
      const [requestsResult, jobsResult] = await Promise.all([
        api.GET("/v1/hiring-requests", { headers }),
        api.GET("/v1/jobs", { headers }),
      ]);
      if (requestsResult.error) throw new Error(apiErrorMessage(requestsResult, "درخواست‌های جذب نیرو بارگذاری نشدند"));
      if (jobsResult.error) throw new Error(apiErrorMessage(jobsResult, "موقعیت‌های شغلی بارگذاری نشدند"));
      setItems((requestsResult.data ?? []) as HiringRequest[]);
      setJobs(jobsResult.data ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "درخواست‌های جذب نیرو بارگذاری نشدند");
    } finally {
      setLoading(false);
    }
  }, [identity]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const resolved = await resolveTenantIdentity();
        if (!active) return;
        setIdentity(resolved);
        await load(resolved);
      } catch (cause) {
        if (active) {
          setError(cause instanceof Error ? cause.message : "درخواست‌های جذب نیرو بارگذاری نشدند");
          setLoading(false);
        }
      }
    })();
    return () => { active = false; };
  }, []);

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return items.filter((item) => {
      if (statusFilter !== "all" && item.status !== statusFilter) return false;
      if (!normalized) return true;
      return [
        item.title,
        item.hiringTeam,
        item.department,
        item.seniority,
        item.location,
        item.requesterName,
        item.linkedJobTitle,
        item.status,
        ...item.requirements,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized));
    });
  }, [items, query, statusFilter]);

  const selectableItems = useMemo(
    () => filteredItems.filter((item) => item.status === "draft" && !item.linkedJobId),
    [filteredItems],
  );
  const selectedVisibleCount = selectableItems.filter((item) => selectedIds.has(item.id)).length;
  const allVisibleSelected = selectableItems.length > 0 && selectedVisibleCount === selectableItems.length;
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected;

  function resetForm() {
    setEditingId(undefined);
    setForm(EMPTY_FORM);
  }

  function startEdit(item: HiringRequest) {
    setEditingId(item.id);
    setForm({
      title: item.title,
      hiringTeam: item.hiringTeam,
      department: item.department ?? "",
      headcount: String(item.headcount),
      seniority: item.seniority ?? "",
      location: item.location ?? "",
      businessReason: item.businessReason,
      requirements: item.requirements.join("\n"),
    });
    setError(undefined);
    setFeedback(undefined);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveRequest(event: FormEvent) {
    event.preventDefault();
    if (!identity) return;
    const mode = editingId ? `edit-${editingId}` : "create";
    setBusy(mode);
    setError(undefined);
    setFeedback(undefined);
    const body = {
      title: form.title.trim(),
      hiringTeam: form.hiringTeam.trim(),
      ...(form.department.trim() ? { department: form.department.trim() } : {}),
      headcount: Number(form.headcount),
      ...(form.seniority.trim() ? { seniority: form.seniority.trim() } : {}),
      ...(form.location.trim() ? { location: form.location.trim() } : {}),
      businessReason: form.businessReason.trim(),
      requirements: form.requirements.split("\n").map((value) => value.trim()).filter(Boolean),
    };

    const result = editingId
      ? await api.PATCH("/v1/hiring-requests/{hiringRequestId}", {
          params: { path: { hiringRequestId: editingId } },
          headers: tenantHeaders(identity),
          body,
        })
      : await api.POST("/v1/hiring-requests", {
          headers: tenantHeaders(identity),
          body,
        });

    if (result.error) {
      setError(apiErrorMessage(result, editingId ? "ویرایش درخواست جذب نیرو ناموفق بود" : "درخواست جذب نیرو ایجاد نشد"));
      setBusy(undefined);
      return;
    }

    setFeedback({
      tone: "success",
      text: editingId ? "تغییرات پیش‌نویس درخواست ذخیره شد." : "پیش‌نویس درخواست جذب نیرو ایجاد شد.",
    });
    resetForm();
    setBusy(undefined);
    await load(identity);
  }

  function toggleItem(id: string, checked: boolean) {
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
      for (const item of selectableItems) {
        if (checked) next.add(item.id);
        else next.delete(item.id);
      }
      return next;
    });
  }

  async function confirmDelete() {
    if (!identity || deleteIds.length === 0 || deleting) return;
    setDeleting(true);
    setFeedback(undefined);
    try {
      const result = await api.POST("/v1/hiring-requests/bulk-delete", {
        headers: tenantHeaders(identity),
        body: { ids: deleteIds },
      });
      if (result.error || !result.data) throw new Error(apiErrorMessage(result, "حذف درخواست‌های انتخاب‌شده ناموفق بود"));
      const deletedIds = new Set(result.data.deletedIds);
      setItems((current) => current.filter((item) => !deletedIds.has(item.id)));
      setSelectedIds((current) => {
        const next = new Set(current);
        result.data.deletedIds.forEach((id) => next.delete(id));
        return next;
      });
      if (editingId && deletedIds.has(editingId)) resetForm();
      setFeedback(
        result.data.blockedIds.length
          ? { tone: "warning", text: `${formatFaNumber(result.data.deletedCount)} درخواست حذف شد؛ ${formatFaNumber(result.data.blockedIds.length)} مورد دیگر پیش‌نویس قابل حذف متعلق به شما نبود.` }
          : { tone: "success", text: `${formatFaNumber(result.data.deletedCount)} درخواست جذب نیرو حذف شد.` },
      );
      setDeleteIds([]);
    } catch (cause) {
      setFeedback({ tone: "error", text: cause instanceof Error ? cause.message : "حذف درخواست‌ها ناموفق بود" });
    } finally {
      setDeleting(false);
    }
  }

  async function submitRequest(id: string) {
    if (!identity) return;
    setBusy(`submit-${id}`);
    const result = await api.POST("/v1/hiring-requests/{hiringRequestId}/submit", {
      params: { path: { hiringRequestId: id } },
      headers: tenantHeaders(identity),
    });
    if (result.error) setError(apiErrorMessage(result, "ارسال درخواست به منابع انسانی ناموفق بود"));
    setBusy(undefined);
    if (!result.error) await load(identity);
  }

  async function reviewRequest(id: string, decision: "approve" | "reject") {
    if (!identity) return;
    setBusy(`${decision}-${id}`);
    const result = await api.POST("/v1/hiring-requests/{hiringRequestId}/review", {
      params: { path: { hiringRequestId: id } },
      headers: tenantHeaders(identity),
      body: {
        decision,
        note: decision === "approve" ? "تأیید برای آغاز فرایند جذب" : "ردشده در بررسی منابع انسانی",
      },
    });
    if (result.error) setError(apiErrorMessage(result, "بررسی درخواست جذب نیرو ناموفق بود"));
    setBusy(undefined);
    if (!result.error) await load(identity);
  }

  async function linkJob(item: HiringRequest) {
    if (!identity) return;
    const jobId = selectedJobIds[item.id];
    if (!jobId) {
      setError("پیش از اتصال، یک موقعیت شغلی انتخاب کنید");
      return;
    }
    setBusy(`link-${item.id}`);
    setError(undefined);
    const result = await api.POST("/v1/hiring-requests/{hiringRequestId}/link-job", {
      params: { path: { hiringRequestId: item.id } },
      headers: tenantHeaders(identity),
      body: { jobId },
    });
    if (result.error) {
      setError(apiErrorMessage(result, "اتصال موقعیت شغلی ناموفق بود"));
    } else {
      setSelectedJobIds((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
    }
    setBusy(undefined);
    if (!result.error) await load(identity);
  }

  const canCreate = access.can("hiring_request.create");
  const canManage = access.can("hiring_request.manage");

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-1 text-[11px] font-medium text-indigo-600">نیاز نیروی انسانی</div>
        <h1 className="text-[28px] font-semibold tracking-[-.03em] text-slate-950">درخواست‌های جذب نیرو</h1>
        <p className="mt-1.5 max-w-3xl text-[12px] leading-5 text-slate-500">
          تیم درخواست‌کننده نیاز را ثبت می‌کند؛ پس از تأیید، منابع انسانی فرایند جذب را پیش می‌برد و استخدام نهایی تا ثبت تأیید فنی تیم درخواست‌کننده مسدود می‌ماند.
        </p>
      </div>

      {error ? <InlineFeedback tone="error">{error}</InlineFeedback> : null}
      {feedback ? <InlineFeedback tone={feedback.tone}>{feedback.text}</InlineFeedback> : null}

      {canCreate ? (
        <Panel className="p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-[13px] font-semibold text-slate-900">{editingId ? "ویرایش پیش‌نویس درخواست" : "ایجاد درخواست جذب نیرو"}</h2>
              <p className="mt-1 text-[10px] text-slate-500">{editingId ? "فقط پیش‌نویس متعلق به درخواست‌کننده قابل ویرایش است." : "درخواست جدید ابتدا به‌صورت پیش‌نویس ذخیره می‌شود."}</p>
            </div>
            {editingId ? <button type="button" onClick={resetForm} className="text-[10px] font-semibold text-slate-500 hover:text-slate-800">انصراف از ویرایش</button> : null}
          </div>
          <form onSubmit={saveRequest} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="عنوان نقش · توسعه‌دهنده ارشد .NET" className="h-10 rounded-lg border border-slate-200 px-3 text-xs" />
            <input required value={form.hiringTeam} onChange={(e) => setForm({ ...form, hiringTeam: e.target.value })} placeholder="تیم درخواست‌کننده · پلتفرم .NET" className="h-10 rounded-lg border border-slate-200 px-3 text-xs" />
            <input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder="واحد سازمانی" className="h-10 rounded-lg border border-slate-200 px-3 text-xs" />
            <input required min={1} max={100} type="number" value={form.headcount} onChange={(e) => setForm({ ...form, headcount: e.target.value })} className="h-10 rounded-lg border border-slate-200 px-3 text-xs" />
            <input value={form.seniority} onChange={(e) => setForm({ ...form, seniority: e.target.value })} placeholder="سطح ارشدیت" className="h-10 rounded-lg border border-slate-200 px-3 text-xs" />
            <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="محل کار" className="h-10 rounded-lg border border-slate-200 px-3 text-xs" />
            <textarea required value={form.businessReason} onChange={(e) => setForm({ ...form, businessReason: e.target.value })} placeholder="چرا تیم به این نیروی جدید نیاز دارد؟" className="min-h-24 rounded-lg border border-slate-200 p-3 text-xs md:col-span-2" />
            <textarea value={form.requirements} onChange={(e) => setForm({ ...form, requirements: e.target.value })} placeholder={"الزامات اولیه، هر خط یک مورد\nC# / ASP.NET Core\nSQL\nمعماری میکروسرویس"} className="min-h-24 rounded-lg border border-slate-200 p-3 text-xs md:col-span-2" />
            <div className="flex items-end gap-2">
              <button disabled={Boolean(busy)} className="h-10 rounded-lg bg-indigo-600 px-4 text-xs font-semibold text-white disabled:opacity-50" type="submit">
                {busy === (editingId ? `edit-${editingId}` : "create") ? "در حال ذخیره…" : editingId ? "ذخیره تغییرات" : "ایجاد پیش‌نویس درخواست"}
              </button>
              {editingId ? <button type="button" onClick={resetForm} className="h-10 rounded-lg border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-600">انصراف</button> : null}
            </div>
          </form>
        </Panel>
      ) : null}

      <Panel>
        {selectedIds.size > 0 ? (
          <BulkActionBar selectedCount={selectedIds.size} noun="درخواست" onClear={() => setSelectedIds(new Set())}>
            <button type="button" onClick={() => setDeleteIds([...selectedIds])} className="h-8 rounded-lg bg-rose-600 px-3 text-[10px] font-semibold text-white hover:bg-rose-700">
              حذف انتخاب‌شده‌ها
            </button>
          </BulkActionBar>
        ) : (
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-4">
            <div className="relative min-w-[280px] flex-1">
              <Icon name="search" size={14} className="absolute start-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                className="h-10 w-full rounded-[10px] border border-slate-200 bg-slate-50 ps-10 pe-3 text-[11px] outline-none focus:border-indigo-300 focus:bg-white focus:ring-4 focus:ring-indigo-50"
                placeholder="جست‌وجو در عنوان، تیم، مسئول، موقعیت یا وضعیت..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <select
              aria-label="فیلتر وضعیت درخواست جذب نیرو"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="h-10 rounded-[10px] border border-slate-200 bg-white px-3 text-[11px] text-slate-700 outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50"
            >
              <option value="all">همه وضعیت‌ها</option>
              <option value="draft">پیش‌نویس</option>
              <option value="submitted">ارسال‌شده</option>
              <option value="approved">تأییدشده</option>
              <option value="recruiting">در حال جذب</option>
              <option value="filled">تکمیل‌شده</option>
              <option value="rejected">ردشده</option>
              <option value="cancelled">لغوشده</option>
            </select>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="data-table min-w-[1160px]">
            <thead>
              <tr>
                <th className="w-10">
                  {canCreate ? (
                    <SelectionCheckbox
                      label="انتخاب همه پیش‌نویس‌های قابل حذف"
                      checked={allVisibleSelected}
                      indeterminate={someVisibleSelected}
                      disabled={selectableItems.length === 0}
                      onChange={toggleAllVisible}
                    />
                  ) : null}
                </th>
                {["درخواست", "تیم", "مسئولان", "ظرفیت", "موقعیت شغلی", "وضعیت", "اقدامات"].map((heading) => <th key={heading}>{heading}</th>)}
              </tr>
            </thead>
            <tbody>
              {loading ? <tr><td colSpan={8} className="py-12 text-center text-slate-400">در حال بارگذاری درخواست‌های جذب نیرو…</td></tr>
              : filteredItems.length === 0 ? <tr><td colSpan={8} className="py-12 text-center text-slate-400">{items.length ? "درخواستی با فیلترهای فعلی پیدا نشد." : "هنوز درخواست جذب نیرویی ثبت نشده است."}</td></tr>
              : filteredItems.map((item) => (
                <tr key={item.id}>
                  <td>
                    {canCreate ? (
                      <SelectionCheckbox
                        label={`انتخاب ${item.title}`}
                        checked={selectedIds.has(item.id)}
                        disabled={item.status !== "draft" || Boolean(item.linkedJobId)}
                        onChange={(checked) => toggleItem(item.id, checked)}
                      />
                    ) : null}
                  </td>
                  <td className="max-w-[320px]"><div className="font-semibold text-slate-900">{item.title}</div><div className="mt-1 line-clamp-2 text-[10px] text-slate-400">{item.businessReason}</div></td>
                  <td><div className="font-medium">{item.hiringTeam}</div><div className="mt-1 text-[9px] text-slate-400">{item.department || item.seniority || "—"}</div></td>
                  <td><div>{item.requesterName}</div><div className="mt-1 text-[9px] text-slate-400">{item.hrOwnerName ? `منابع انسانی: ${item.hrOwnerName}` : "مسئول منابع انسانی تعیین نشده"}</div></td>
                  <td>{formatFaNumber(item.hiredCount)} / {formatFaNumber(item.headcount)}</td>
                  <td>{item.linkedJobId ? <Link className="font-medium text-indigo-600" href={`/app/jobs/${item.linkedJobId}`}>{item.linkedJobTitle || "مشاهده موقعیت"}</Link> : <span className="text-slate-400">متصل نشده</span>}</td>
                  <td><Pill tone={statusTone(item.status)}>{faDomainLabel(item.status)}</Pill></td>
                  <td>
                    <div className="flex flex-wrap gap-2">
                      {item.status === "draft" && canCreate ? (
                        <>
                          <button disabled={Boolean(busy)} className="text-[10px] font-semibold text-slate-600 hover:text-slate-900" onClick={() => startEdit(item)}>ویرایش</button>
                          <button disabled={Boolean(busy)} className="text-[10px] font-semibold text-rose-600 hover:text-rose-700" onClick={() => setDeleteIds([item.id])}>حذف</button>
                          <button disabled={Boolean(busy)} className="text-[10px] font-semibold text-indigo-600" onClick={() => void submitRequest(item.id)}>ارسال به منابع انسانی</button>
                        </>
                      ) : null}
                      {item.status === "submitted" && canManage ? <>
                        <button disabled={Boolean(busy)} className="text-[10px] font-semibold text-emerald-600" onClick={() => void reviewRequest(item.id, "approve")}>تأیید</button>
                        <button disabled={Boolean(busy)} className="text-[10px] font-semibold text-rose-600" onClick={() => void reviewRequest(item.id, "reject")}>رد</button>
                      </> : null}
                      {item.status === "approved" && canManage ? (
                        <div className="flex min-w-[300px] flex-col gap-2">
                          <Link href={`/app/jobs/new?hiringRequestId=${item.id}`} className="inline-flex h-8 items-center justify-center rounded-lg bg-indigo-600 px-3 text-[10px] font-semibold text-white hover:bg-indigo-700">
                            ایجاد موقعیت از این درخواست
                          </Link>
                          <div className="text-[9px] text-slate-400">یا این درخواست را به یک موقعیت شغلی موجود متصل کنید:</div>
                          <div className="flex items-center gap-2">
                            <select
                              aria-label={`انتخاب موقعیت شغلی برای ${item.title}`}
                              value={selectedJobIds[item.id] ?? ""}
                              onChange={(event) => setSelectedJobIds((current) => ({ ...current, [item.id]: event.target.value }))}
                              className="h-8 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-[10px] text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50"
                            >
                              <option value="">انتخاب موقعیت شغلی…</option>
                              {jobs.map((job) => <option key={job.id} value={job.id}>{job.title}{job.department ? ` · ${job.department}` : ""} · {faDomainLabel(job.status)}</option>)}
                            </select>
                            <button disabled={Boolean(busy) || !selectedJobIds[item.id]} className="h-8 rounded-lg bg-indigo-600 px-3 text-[10px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40" onClick={() => void linkJob(item)}>
                              {busy === `link-${item.id}` ? "در حال اتصال…" : "اتصال"}
                            </button>
                          </div>
                          <div className="flex items-center justify-between gap-3 text-[9px]">
                            <span className="text-slate-400">{jobs.length ? `${formatFaNumber(jobs.length)} موقعیت قابل انتخاب` : "هنوز موقعیتی برای انتخاب وجود ندارد"}</span>
                            <Link href="/app/jobs/new" className="font-semibold text-slate-500 hover:text-indigo-600">ایجاد موقعیت مستقل</Link>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-[10px] text-slate-400">
          <span>{formatFaNumber(filteredItems.length)} از {formatFaNumber(items.length)} درخواست</span>
          <span>حذف فقط برای پیش‌نویس‌های بدون موقعیت متصل فعال است.</span>
        </div>
      </Panel>

      <ConfirmDialog
        open={deleteIds.length > 0}
        title={deleteIds.length > 1 ? "حذف درخواست‌های انتخاب‌شده؟" : "حذف پیش‌نویس درخواست؟"}
        description={
          deleteIds.length > 1
            ? `این کار ${formatFaNumber(deleteIds.length)} پیش‌نویس انتخاب‌شده را حذف می‌کند. درخواست‌های ارسال‌شده یا متصل‌شده حذف نمی‌شوند.`
            : "این پیش‌نویس حذف می‌شود و قابل بازگردانی نیست. درخواست ارسال‌شده یا متصل‌شده از این مسیر حذف نمی‌شود."
        }
        confirmLabel={deleteIds.length > 1 ? "حذف درخواست‌ها" : "حذف درخواست"}
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteIds([])}
      />
    </div>
  );
}

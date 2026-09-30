"use client";

import type { components } from "@interview/api-client";
import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, apiErrorMessage } from "../../../lib/api";
import { faDomainLabel } from "../../../lib/i18n";
import { formatFaNumber } from "../../../lib/fa-numbers";
import { resolveTenantIdentity, tenantHeaders, type TenantIdentity } from "../../../lib/tenant-client";
import { useInternalAccess } from "../../../components/product/internal-access";
import { Panel, Pill } from "../../../components/product/recruiting-ui";

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
  requesterName: string;
  hrOwnerName?: string;
  linkedJobId?: string;
  linkedJobTitle?: string;
  reviewNote?: string;
  applicationCount: number;
  hiredCount: number;
  updatedAt: string;
}

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [form, setForm] = useState({
    title: "", hiringTeam: "", department: "", headcount: "1",
    seniority: "", location: "", businessReason: "", requirements: "",
  });

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

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!identity) return;
    setBusy("create");
    setError(undefined);
    const result = await api.POST("/v1/hiring-requests", {
      headers: tenantHeaders(identity),
      body: {
        title: form.title,
        hiringTeam: form.hiringTeam,
        ...(form.department ? { department: form.department } : {}),
        headcount: Number(form.headcount),
        ...(form.seniority ? { seniority: form.seniority } : {}),
        ...(form.location ? { location: form.location } : {}),
        businessReason: form.businessReason,
        requirements: form.requirements.split("\n").map((value) => value.trim()).filter(Boolean),
      },
    });
    if (result.error) {
      setError(apiErrorMessage(result, "درخواست جذب نیرو ایجاد نشد"));
      setBusy(undefined);
      return;
    }
    setForm({
      title: "", hiringTeam: "", department: "", headcount: "1",
      seniority: "", location: "", businessReason: "", requirements: "",
    });
    setBusy(undefined);
    await load(identity);
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

      {error ? <div className="rounded-xl border border-rose-100 bg-rose-50 p-4 text-xs text-rose-700">{error}</div> : null}

      {canCreate ? (
        <Panel className="p-5">
          <form onSubmit={create} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="عنوان نقش · توسعه‌دهنده ارشد .NET" className="h-10 rounded-lg border border-slate-200 px-3 text-xs" />
            <input required value={form.hiringTeam} onChange={(e) => setForm({ ...form, hiringTeam: e.target.value })} placeholder="تیم درخواست‌کننده · پلتفرم .NET" className="h-10 rounded-lg border border-slate-200 px-3 text-xs" />
            <input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder="واحد سازمانی" className="h-10 rounded-lg border border-slate-200 px-3 text-xs" />
            <input required min={1} max={100} type="number" value={form.headcount} onChange={(e) => setForm({ ...form, headcount: e.target.value })} className="h-10 rounded-lg border border-slate-200 px-3 text-xs" />
            <input value={form.seniority} onChange={(e) => setForm({ ...form, seniority: e.target.value })} placeholder="سطح ارشدیت" className="h-10 rounded-lg border border-slate-200 px-3 text-xs" />
            <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="محل کار" className="h-10 rounded-lg border border-slate-200 px-3 text-xs" />
            <textarea required value={form.businessReason} onChange={(e) => setForm({ ...form, businessReason: e.target.value })} placeholder="چرا تیم به این نیروی جدید نیاز دارد؟" className="min-h-24 rounded-lg border border-slate-200 p-3 text-xs md:col-span-2" />
            <textarea value={form.requirements} onChange={(e) => setForm({ ...form, requirements: e.target.value })} placeholder={"الزامات اولیه، هر خط یک مورد\nC# / ASP.NET Core\nSQL\nمعماری میکروسرویس"} className="min-h-24 rounded-lg border border-slate-200 p-3 text-xs md:col-span-2" />
            <div className="flex items-end">
              <button disabled={busy === "create"} className="h-10 rounded-lg bg-indigo-600 px-4 text-xs font-semibold text-white disabled:opacity-50" type="submit">
                {busy === "create" ? "در حال ایجاد…" : "ایجاد پیش‌نویس درخواست"}
              </button>
            </div>
          </form>
        </Panel>
      ) : null}

      <Panel>
        <div className="overflow-x-auto">
          <table className="data-table min-w-[1100px]">
            <thead><tr>{["درخواست","تیم","مسئولان","ظرفیت","موقعیت شغلی","وضعیت","اقدامات"].map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={7} className="py-12 text-center text-slate-400">در حال بارگذاری درخواست‌های جذب نیرو…</td></tr>
              : items.length === 0 ? <tr><td colSpan={7} className="py-12 text-center text-slate-400">هنوز درخواست جذب نیرویی ثبت نشده است.</td></tr>
              : items.map((item) => (
                <tr key={item.id}>
                  <td className="max-w-[320px]"><div className="font-semibold text-slate-900">{item.title}</div><div className="mt-1 line-clamp-2 text-[10px] text-slate-400">{item.businessReason}</div></td>
                  <td><div className="font-medium">{item.hiringTeam}</div><div className="mt-1 text-[9px] text-slate-400">{item.department || item.seniority || "—"}</div></td>
                  <td><div>{item.requesterName}</div><div className="mt-1 text-[9px] text-slate-400">{item.hrOwnerName ? `منابع انسانی: ${item.hrOwnerName}` : "مسئول منابع انسانی تعیین نشده"}</div></td>
                  <td>{formatFaNumber(item.hiredCount)} / {formatFaNumber(item.headcount)}</td>
                  <td>{item.linkedJobId ? <Link className="font-medium text-indigo-600" href={`/app/jobs/${item.linkedJobId}`}>{item.linkedJobTitle || "مشاهده موقعیت"}</Link> : <span className="text-slate-400">متصل نشده</span>}</td>
                  <td><Pill tone={statusTone(item.status)}>{faDomainLabel(item.status)}</Pill></td>
                  <td><div className="flex flex-wrap gap-2">
                    {item.status === "draft" && canCreate ? <button disabled={Boolean(busy)} className="text-[10px] font-semibold text-indigo-600" onClick={() => void submitRequest(item.id)}>ارسال به منابع انسانی</button> : null}
                    {item.status === "submitted" && canManage ? <>
                      <button disabled={Boolean(busy)} className="text-[10px] font-semibold text-emerald-600" onClick={() => void reviewRequest(item.id, "approve")}>تأیید</button>
                      <button disabled={Boolean(busy)} className="text-[10px] font-semibold text-rose-600" onClick={() => void reviewRequest(item.id, "reject")}>رد</button>
                    </> : null}
                    {item.status === "approved" && canManage ? (
                      <div className="flex min-w-[280px] flex-col gap-2">
                        <div className="flex items-center gap-2">
                          <select
                            aria-label={`انتخاب موقعیت شغلی برای ${item.title}`}
                            value={selectedJobIds[item.id] ?? ""}
                            onChange={(event) => setSelectedJobIds((current) => ({ ...current, [item.id]: event.target.value }))}
                            className="h-8 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-[10px] text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50"
                          >
                            <option value="">انتخاب موقعیت شغلی…</option>
                            {jobs.map((job) => (
                              <option key={job.id} value={job.id}>
                                {job.title}{job.department ? ` · ${job.department}` : ""} · {faDomainLabel(job.status)}
                              </option>
                            ))}
                          </select>
                          <button
                            disabled={Boolean(busy) || !selectedJobIds[item.id]}
                            className="h-8 rounded-lg bg-indigo-600 px-3 text-[10px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                            onClick={() => void linkJob(item)}
                          >
                            {busy === `link-${item.id}` ? "در حال اتصال…" : "اتصال"}
                          </button>
                        </div>
                        <div className="flex items-center justify-between gap-3 text-[9px]">
                          <span className="text-slate-400">
                            {jobs.length ? `${formatFaNumber(jobs.length)} موقعیت قابل انتخاب` : "هنوز موقعیتی برای انتخاب وجود ندارد"}
                          </span>
                          <Link href="/app/jobs/new" className="font-semibold text-indigo-600">ایجاد موقعیت جدید</Link>
                        </div>
                      </div>
                    ) : null}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

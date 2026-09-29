"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { Panel, Pill } from "../../../components/product/recruiting-ui";
import { useInternalAccess } from "../../../components/product/internal-access";
import { resolveTenantIdentity, tenantHeaders } from "../../../lib/tenant-client";

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

async function requestJson(path: string, init?: RequestInit) {
  const identity = await resolveTenantIdentity();
  const response = await fetch(`/api/backend${path}`, {
    ...init,
    headers: { ...tenantHeaders(identity, Boolean(init?.body)), ...(init?.headers ?? {}) },
  });
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "message" in payload
      ? String(payload.message)
      : `Request failed with status ${response.status}`;
    throw new Error(message);
  }
  return payload;
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
  const [items, setItems] = useState<HiringRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [form, setForm] = useState({
    title: "", hiringTeam: "", department: "", headcount: "1",
    seniority: "", location: "", businessReason: "", requirements: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      setItems((await requestJson("/v1/hiring-requests")) as HiringRequest[]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Hiring requests could not be loaded");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy("create");
    setError(undefined);
    try {
      await requestJson("/v1/hiring-requests", {
        method: "POST",
        body: JSON.stringify({
          title: form.title,
          hiringTeam: form.hiringTeam,
          department: form.department || undefined,
          headcount: Number(form.headcount),
          seniority: form.seniority || undefined,
          location: form.location || undefined,
          businessReason: form.businessReason,
          requirements: form.requirements.split("\n").map((value) => value.trim()).filter(Boolean),
        }),
      });
      setForm({
        title: "", hiringTeam: "", department: "", headcount: "1",
        seniority: "", location: "", businessReason: "", requirements: "",
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Hiring request could not be created");
    } finally {
      setBusy(undefined);
    }
  }

  async function action(key: string, path: string, body?: unknown) {
    setBusy(key);
    setError(undefined);
    try {
      await requestJson(path, {
        method: "POST",
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Workflow action failed");
    } finally {
      setBusy(undefined);
    }
  }

  async function linkJob(item: HiringRequest) {
    const jobId = window.prompt("Paste the approved Job ID to link to this request")?.trim();
    if (!jobId) return;
    await action(
      `link-${item.id}`,
      `/v1/hiring-requests/${item.id}/link-job`,
      { jobId },
    );
  }

  const canCreate = access.can("hiring_request.create");
  const canManage = access.can("hiring_request.manage");

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-1 text-[11px] font-medium text-indigo-600">Workforce demand</div>
        <h1 className="text-[28px] font-semibold tracking-[-.03em] text-slate-950">Hiring Requests</h1>
        <p className="mt-1.5 max-w-3xl text-[12px] leading-5 text-slate-500">
          The requesting team defines the need. HR owns recruiting after approval. A requisition-backed hire remains blocked until the requesting team records technical approval.
        </p>
      </div>

      {error ? <div className="rounded-xl border border-rose-100 bg-rose-50 p-4 text-xs text-rose-700">{error}</div> : null}

      {canCreate ? (
        <Panel className="p-5">
          <form onSubmit={create} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Role · Senior .NET Developer" className="h-10 rounded-lg border border-slate-200 px-3 text-xs" />
            <input required value={form.hiringTeam} onChange={(e) => setForm({ ...form, hiringTeam: e.target.value })} placeholder="Requesting team · .NET Platform" className="h-10 rounded-lg border border-slate-200 px-3 text-xs" />
            <input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder="Department" className="h-10 rounded-lg border border-slate-200 px-3 text-xs" />
            <input required min={1} max={100} type="number" value={form.headcount} onChange={(e) => setForm({ ...form, headcount: e.target.value })} className="h-10 rounded-lg border border-slate-200 px-3 text-xs" />
            <input value={form.seniority} onChange={(e) => setForm({ ...form, seniority: e.target.value })} placeholder="Seniority" className="h-10 rounded-lg border border-slate-200 px-3 text-xs" />
            <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Location" className="h-10 rounded-lg border border-slate-200 px-3 text-xs" />
            <textarea required value={form.businessReason} onChange={(e) => setForm({ ...form, businessReason: e.target.value })} placeholder="Why does the team need this hire?" className="min-h-24 rounded-lg border border-slate-200 p-3 text-xs md:col-span-2" />
            <textarea value={form.requirements} onChange={(e) => setForm({ ...form, requirements: e.target.value })} placeholder={"Initial requirements, one per line\nC# / ASP.NET Core\nSQL\nMicroservices"} className="min-h-24 rounded-lg border border-slate-200 p-3 text-xs md:col-span-2" />
            <div className="flex items-end">
              <button disabled={busy === "create"} className="h-10 rounded-lg bg-indigo-600 px-4 text-xs font-semibold text-white disabled:opacity-50" type="submit">
                {busy === "create" ? "Creating…" : "Create draft request"}
              </button>
            </div>
          </form>
        </Panel>
      ) : null}

      <Panel>
        <div className="overflow-x-auto">
          <table className="data-table min-w-[1100px]">
            <thead><tr>{["Request","Team","Owners","Headcount","Job","Status","Actions"].map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={7} className="py-12 text-center text-slate-400">Loading hiring requests…</td></tr>
              : items.length === 0 ? <tr><td colSpan={7} className="py-12 text-center text-slate-400">No hiring requests yet.</td></tr>
              : items.map((item) => (
                <tr key={item.id}>
                  <td className="max-w-[320px]"><div className="font-semibold text-slate-900">{item.title}</div><div className="mt-1 line-clamp-2 text-[10px] text-slate-400">{item.businessReason}</div></td>
                  <td><div className="font-medium">{item.hiringTeam}</div><div className="mt-1 text-[9px] text-slate-400">{item.department || item.seniority || "—"}</div></td>
                  <td><div>{item.requesterName}</div><div className="mt-1 text-[9px] text-slate-400">{item.hrOwnerName ? `HR: ${item.hrOwnerName}` : "HR unassigned"}</div></td>
                  <td>{item.hiredCount} / {item.headcount}</td>
                  <td>{item.linkedJobId ? <Link className="font-medium text-indigo-600" href={`/app/jobs/${item.linkedJobId}`}>{item.linkedJobTitle || "Open job"}</Link> : <span className="text-slate-400">Not linked</span>}</td>
                  <td><Pill tone={statusTone(item.status)}>{item.status}</Pill></td>
                  <td><div className="flex flex-wrap gap-2">
                    {item.status === "draft" && canCreate ? <button disabled={Boolean(busy)} className="text-[10px] font-semibold text-indigo-600" onClick={() => void action(`submit-${item.id}`, `/v1/hiring-requests/${item.id}/submit`)}>Submit to HR</button> : null}
                    {item.status === "submitted" && canManage ? <>
                      <button disabled={Boolean(busy)} className="text-[10px] font-semibold text-emerald-600" onClick={() => void action(`approve-${item.id}`, `/v1/hiring-requests/${item.id}/review`, { decision: "approve", note: "Approved for recruiting" })}>Approve</button>
                      <button disabled={Boolean(busy)} className="text-[10px] font-semibold text-rose-600" onClick={() => void action(`reject-${item.id}`, `/v1/hiring-requests/${item.id}/review`, { decision: "reject", note: "Rejected by HR review" })}>Reject</button>
                    </> : null}
                    {item.status === "approved" && canManage ? <>
                      <Link href="/app/jobs/new" className="text-[10px] font-semibold text-indigo-600">Create Job</Link>
                      <button disabled={Boolean(busy)} className="text-[10px] font-semibold text-indigo-600" onClick={() => void linkJob(item)}>Link Job</button>
                    </> : null}
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

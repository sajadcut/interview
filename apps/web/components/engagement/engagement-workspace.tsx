"use client";

import { useEffect, useState } from "react";
import { Panel, Pill } from "../product/recruiting-ui";
import { useInternalAccess } from "../product/internal-access";
import { resolveTenantIdentity, tenantHeaders, type TenantIdentity } from "../../lib/tenant-client";

interface ConversationRow {
  id: string;
  candidate_name?: string;
  channel: string;
  status: string;
  latest_message_id?: string;
  latest_direction?: string;
  latest_body?: string;
  latest_approval_state?: string;
  latest_delivery_status?: string;
}
interface ScreeningRow {
  id: string;
  application_id: string;
  candidate_name?: string;
  job_title?: string;
  recommendation?: string;
  review_state: string;
}
interface SchedulingRow {
  id: string;
  application_id: string;
  candidate_name?: string;
  job_title?: string;
  interview_type: string;
  status: string;
  selected_start?: string;
}
interface NotificationRow {
  id: string;
  candidate_name?: string;
  notification_type: string;
  channel: string;
  status: string;
}
interface KnowledgeRow {
  id: string;
  title: string;
  knowledge_type: string;
  status: string;
}
interface Workspace {
  conversations: ConversationRow[];
  screening: ScreeningRow[];
  scheduling: SchedulingRow[];
  notifications: NotificationRow[];
  knowledge: KnowledgeRow[];
}

export function EngagementWorkspace() {
  const access = useInternalAccess();
  const [identity, setIdentity] = useState<TenantIdentity>();
  const [workspace, setWorkspace] = useState<Workspace>();
  const [message, setMessage] = useState<string>();
  const [loading, setLoading] = useState(true);

  async function load(resolved?: TenantIdentity) {
    const current = resolved ?? identity ?? (await resolveTenantIdentity());
    if (!identity) setIdentity(current);
    const response = await fetch("/api/backend/v1/engagement/workspace", {
      headers: tenantHeaders(current),
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) throw new Error("Engagement workspace could not be loaded");
    setWorkspace((await response.json()) as Workspace);
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const resolved = await resolveTenantIdentity();
        if (!active) return;
        setIdentity(resolved);
        await load(resolved);
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : "Engagement workspace failed");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function post(path: string, body: Record<string, unknown>) {
    if (!identity) return false;
    const response = await fetch(`/api/backend${path}`, {
      method: "POST",
      headers: tenantHeaders(identity, true),
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    if (!response.ok) {
      setMessage(payload.message || "Action failed");
      return false;
    }
    setMessage("Action completed and recorded.");
    await load(identity);
    return true;
  }

  async function patch(path: string, body: Record<string, unknown>) {
    if (!identity) return false;
    const response = await fetch(`/api/backend${path}`, {
      method: "PATCH",
      headers: tenantHeaders(identity, true),
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    if (!response.ok) {
      setMessage(payload.message || "Action failed");
      return false;
    }
    setMessage("Action completed and recorded.");
    await load(identity);
    return true;
  }

  async function createKnowledge() {
    const title = window.prompt("Knowledge title")?.trim();
    if (!title) return;
    const body = window.prompt("Approved factual content")?.trim();
    if (!body) return;
    await post("/v1/knowledge", { knowledgeType: "recruiting_policy", title, body });
  }

  async function approveKnowledge(item: KnowledgeRow) {
    await post(`/v1/knowledge/${item.id}/approve`, {});
  }

  async function approveMessage(row: ConversationRow) {
    if (!row.latest_message_id) return;
    await post(`/v1/messages/${row.latest_message_id}/approve-send`, {});
  }

  async function reviewScreening(row: ScreeningRow, reviewState: string) {
    const reason = window.prompt("Human review reason")?.trim();
    if (!reason) return;
    await post(`/v1/screening/sessions/${row.id}/review`, { reviewState, reason });
  }

  async function cancelSchedule(row: SchedulingRow) {
    const reason = window.prompt("Cancellation reason")?.trim();
    if (!reason) return;
    await patch(`/v1/scheduling/${row.id}/cancel`, { reason });
  }

  if (loading) return <div className="py-16 text-center text-sm text-slate-500">Loading engagement operations…</div>;
  const data = workspace ?? { conversations: [], screening: [], scheduling: [], notifications: [], knowledge: [] };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[10px] font-medium text-indigo-600">Candidate engagement operations</div>
          <h1 className="mt-2 text-[26px] font-semibold tracking-tight">Inbox / Outreach</h1>
          <p className="mt-1 text-[11px] text-slate-500">Grounded messaging, screening human review, scheduling and delivery queue.</p>
        </div>
        {access.can("knowledge.manage") ? <button type="button" onClick={() => void createKnowledge()} className="h-10 rounded-[10px] bg-indigo-600 px-4 text-[11px] font-semibold text-white">Add approved knowledge</button> : null}
      </div>

      {message ? <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-[10px] text-indigo-800">{message}</div> : null}

      <div className="grid gap-3 sm:grid-cols-4">
        <Panel className="p-4"><div className="text-[9px] text-slate-500">Conversations</div><div className="mt-2 text-2xl font-semibold">{data.conversations.length}</div></Panel>
        <Panel className="p-4"><div className="text-[9px] text-slate-500">Screening review</div><div className="mt-2 text-2xl font-semibold">{data.screening.filter((item) => item.review_state === "pending_human_review").length}</div></Panel>
        <Panel className="p-4"><div className="text-[9px] text-slate-500">Scheduling</div><div className="mt-2 text-2xl font-semibold">{data.scheduling.filter((item) => item.status !== "cancelled").length}</div></Panel>
        <Panel className="p-4"><div className="text-[9px] text-slate-500">Pending notifications</div><div className="mt-2 text-2xl font-semibold">{data.notifications.filter((item) => item.status === "pending").length}</div></Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel className="overflow-hidden">
          <div className="border-b border-slate-100 p-4"><h2 className="text-[12px] font-semibold">Conversations & approval</h2></div>
          <div className="divide-y divide-slate-100">{data.conversations.length ? data.conversations.map((row) => <div key={row.id} className="p-4"><div className="flex items-center justify-between gap-3"><div><div className="text-[10px] font-semibold">{row.candidate_name || "Candidate"} · {row.channel}</div><div className="mt-1 text-[9px] text-slate-500">{row.latest_body || "No messages yet"}</div></div><Pill>{row.latest_delivery_status || row.status}</Pill></div>{access.can("candidate.contact") && row.latest_direction === "outbound" && row.latest_approval_state !== "blocked" && row.latest_delivery_status !== "sent" ? <button type="button" onClick={() => void approveMessage(row)} className="mt-3 rounded-lg bg-indigo-600 px-3 py-2 text-[9px] font-semibold text-white">Approve for delivery</button> : null}</div>) : <div className="p-5 text-[10px] text-slate-500">No conversations yet.</div>}</div>
        </Panel>

        <Panel className="overflow-hidden">
          <div className="border-b border-slate-100 p-4"><h2 className="text-[12px] font-semibold">Screening human review</h2></div>
          <div className="divide-y divide-slate-100">{data.screening.length ? data.screening.map((row) => <div key={row.id} className="p-4"><div className="flex justify-between gap-3"><div><div className="text-[10px] font-semibold">{row.candidate_name || "Candidate"} · {row.job_title || "Job"}</div><div className="mt-1 text-[9px] text-slate-500">Recommendation: {row.recommendation || "pending"}</div></div><Pill tone={row.review_state === "pending_human_review" ? "amber" : "green"}>{row.review_state}</Pill></div>{access.can("screening.manage") && row.review_state === "pending_human_review" ? <div className="mt-3 flex gap-2"><button type="button" onClick={() => void reviewScreening(row, "approved")} className="rounded-lg border border-slate-200 px-3 py-2 text-[9px]">Approve result</button><button type="button" onClick={() => void reviewScreening(row, "overridden_advance")} className="rounded-lg bg-emerald-600 px-3 py-2 text-[9px] font-semibold text-white">Override advance</button><button type="button" onClick={() => void reviewScreening(row, "overridden_reject")} className="rounded-lg bg-rose-600 px-3 py-2 text-[9px] font-semibold text-white">Override reject</button></div> : null}</div>) : <div className="p-5 text-[10px] text-slate-500">No screening sessions.</div>}</div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel className="overflow-hidden"><div className="border-b border-slate-100 p-4"><h2 className="text-[12px] font-semibold">Scheduling lifecycle</h2></div><div className="divide-y divide-slate-100">{data.scheduling.map((row) => <div key={row.id} className="flex items-center justify-between gap-3 p-4"><div><div className="text-[10px] font-semibold">{row.candidate_name || "Candidate"} · {row.interview_type}</div><div className="mt-1 text-[9px] text-slate-500">{row.job_title || "Job"} · {row.selected_start ? new Date(row.selected_start).toLocaleString() : "Availability pending"}</div></div><div className="flex items-center gap-2"><Pill>{row.status}</Pill>{access.can("scheduling.manage") && row.status !== "cancelled" ? <button type="button" onClick={() => void cancelSchedule(row)} className="rounded-lg border border-slate-200 px-2 py-1 text-[9px]">Cancel</button> : null}</div></div>)}</div></Panel>
        <Panel className="overflow-hidden"><div className="border-b border-slate-100 p-4"><h2 className="text-[12px] font-semibold">Knowledge & notification queue</h2></div><div className="p-4"><div className="space-y-2">{data.knowledge.slice(0, 8).map((item) => <div key={item.id} className="flex items-center justify-between rounded-lg border border-slate-100 p-2"><div><div className="text-[9px] font-semibold">{item.title}</div><div className="text-[8px] text-slate-400">{item.knowledge_type}</div></div><div className="flex items-center gap-2"><Pill>{item.status}</Pill>{access.can("knowledge.manage") && item.status !== "approved" ? <button type="button" onClick={() => void approveKnowledge(item)} className="text-[9px] font-semibold text-indigo-600">Approve</button> : null}</div></div>)}</div><div className="mt-4 border-t border-slate-100 pt-3 text-[9px] text-slate-500">Notifications: {data.notifications.map((item) => `${item.notification_type}:${item.status}`).slice(0, 6).join(" · ") || "none"}</div></div></Panel>
      </div>
    </div>
  );
}

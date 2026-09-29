"use client";

import type { components } from "@interview/api-client";
import { useEffect, useState } from "react";
import { api, apiErrorMessage } from "../../lib/api";
import { faDomainLabel } from "../../lib/i18n";
import { resolveTenantIdentity, tenantHeaders, type TenantIdentity } from "../../lib/tenant-client";
import { Panel, Pill } from "../product/recruiting-ui";
import { useInternalAccess } from "../product/internal-access";

type Workspace = components["schemas"]["EngagementWorkspaceDto"];
type ConversationRow = components["schemas"]["EngagementConversationDto"];
type ScreeningRow = components["schemas"]["EngagementScreeningDto"];
type SchedulingRow = components["schemas"]["EngagementSchedulingDto"];
type KnowledgeRow = components["schemas"]["EngagementKnowledgeDto"];

export function EngagementWorkspace() {
  const access = useInternalAccess();
  const [identity, setIdentity] = useState<TenantIdentity>();
  const [workspace, setWorkspace] = useState<Workspace>();
  const [message, setMessage] = useState<string>();
  const [loadError, setLoadError] = useState<string>();
  const [loading, setLoading] = useState(true);

  async function load(resolved?: TenantIdentity) {
    const current = resolved ?? identity ?? (await resolveTenantIdentity());
    if (!identity) setIdentity(current);
    const result = await api.GET("/v1/engagement/workspace", {
      headers: tenantHeaders(current),
    });
    if (!result.response.ok || !result.data) {
      throw new Error(apiErrorMessage(result, "فضای تعامل با کاندیدا بارگذاری نشد"));
    }
    setWorkspace(result.data);
    setLoadError(undefined);
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
        if (active) setLoadError(error instanceof Error ? error.message : "بارگذاری فضای تعامل ناموفق بود");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function completeAction(result: unknown, fallback: string): Promise<boolean> {
    if (result && typeof result === "object" && "response" in result) {
      const response = (result as { response?: Response }).response;
      if (response?.ok) {
        setMessage("اقدام انجام و ثبت شد.");
        if (identity) await load(identity);
        return true;
      }
    }
    setMessage(apiErrorMessage(result, fallback));
    return false;
  }

  async function createKnowledge() {
    if (!identity) return;
    const title = window.prompt("عنوان محتوای دانشی")?.trim();
    if (!title) return;
    const body = window.prompt("محتوای واقعی و تأییدشده")?.trim();
    if (!body) return;
    const result = await api.POST("/v1/knowledge", {
      headers: tenantHeaders(identity),
      body: { knowledgeType: "recruiting_policy", title, body },
    });
    await completeAction(result, "محتوای دانشی ایجاد نشد");
  }

  async function approveKnowledge(item: KnowledgeRow) {
    if (!identity) return;
    const result = await api.POST("/v1/knowledge/{itemId}/approve", {
      headers: tenantHeaders(identity),
      params: { path: { itemId: item.id } },
      body: {},
    });
    await completeAction(result, "تأیید محتوای دانشی ناموفق بود");
  }

  async function approveMessage(row: ConversationRow) {
    if (!identity || !row.latest_message_id) return;
    const result = await api.POST("/v1/messages/{messageId}/approve-send", {
      headers: tenantHeaders(identity),
      params: { path: { messageId: row.latest_message_id } },
      body: {},
    });
    await completeAction(result, "تأیید پیام خروجی ناموفق بود");
  }

  async function reviewScreening(row: ScreeningRow, reviewState: "approved" | "overridden_advance" | "overridden_reject") {
    if (!identity) return;
    const reason = window.prompt("دلیل بررسی انسانی")?.trim();
    if (!reason) return;
    const result = await api.POST("/v1/screening/sessions/{sessionId}/review", {
      headers: tenantHeaders(identity),
      params: { path: { sessionId: row.id } },
      body: { reviewState, reason },
    });
    await completeAction(result, "نتیجه بررسی غربالگری ثبت نشد");
  }

  async function cancelSchedule(row: SchedulingRow) {
    if (!identity) return;
    const reason = window.prompt("دلیل لغو")?.trim();
    if (!reason) return;
    const result = await api.PATCH("/v1/scheduling/{requestId}/cancel", {
      headers: tenantHeaders(identity),
      params: { path: { requestId: row.id } },
      body: { reason },
    });
    await completeAction(result, "لغو درخواست زمان‌بندی ناموفق بود");
  }

  if (loading) return <div className="py-16 text-center text-sm text-slate-500">در حال بارگذاری عملیات تعامل با کاندیدا…</div>;
  if (loadError && !workspace) {
    return <div role="alert" className="rounded-xl border border-rose-100 bg-rose-50 p-5 text-sm text-rose-700">{loadError}</div>;
  }

  const conversations = workspace?.conversations ?? [];
  const screening = workspace?.screening ?? [];
  const scheduling = workspace?.scheduling ?? [];
  const notifications = workspace?.notifications ?? [];
  const knowledge = workspace?.knowledge ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[10px] font-medium text-indigo-600">عملیات تعامل با کاندیدا</div>
          <h1 className="mt-2 text-[26px] font-semibold tracking-tight">پیام‌ها و ارتباط با کاندیدا</h1>
          <p className="mt-1 text-[11px] text-slate-500">پیام‌رسانی مبتنی بر اطلاعات تأییدشده، بررسی انسانی غربالگری، زمان‌بندی و صف ارسال.</p>
        </div>
        {access.can("knowledge.manage") ? <button type="button" onClick={() => void createKnowledge()} className="h-10 rounded-[10px] bg-indigo-600 px-4 text-[11px] font-semibold text-white">افزودن محتوای تأییدشده</button> : null}
      </div>

      {message ? <div role="status" aria-live="polite" className="rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-[10px] text-indigo-800">{message}</div> : null}
      {loadError ? <div role="alert" className="rounded-xl border border-amber-100 bg-amber-50 p-3 text-[10px] text-amber-800">{loadError}</div> : null}

      <div className="grid gap-3 sm:grid-cols-4">
        <Panel className="p-4"><div className="text-[9px] text-slate-500">گفت‌وگوها</div><div className="mt-2 text-2xl font-semibold">{conversations.length}</div></Panel>
        <Panel className="p-4"><div className="text-[9px] text-slate-500">بررسی غربالگری</div><div className="mt-2 text-2xl font-semibold">{screening.filter((item) => item.review_state === "pending_human_review").length}</div></Panel>
        <Panel className="p-4"><div className="text-[9px] text-slate-500">زمان‌بندی</div><div className="mt-2 text-2xl font-semibold">{scheduling.filter((item) => item.status !== "cancelled").length}</div></Panel>
        <Panel className="p-4"><div className="text-[9px] text-slate-500">اعلان‌های در انتظار</div><div className="mt-2 text-2xl font-semibold">{notifications.filter((item) => item.status === "pending").length}</div></Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel className="overflow-hidden">
          <div className="border-b border-slate-100 p-4"><h2 className="text-[12px] font-semibold">گفت‌وگوها و تأیید ارسال</h2></div>
          <div className="divide-y divide-slate-100">{conversations.length ? conversations.map((row) => <div key={row.id} className="p-4"><div className="flex items-center justify-between gap-3"><div><div className="text-[10px] font-semibold">{row.candidate_name || "کاندیدا"} · {row.channel}</div><div className="mt-1 text-[9px] text-slate-500">{row.latest_body || "هنوز پیامی وجود ندارد"}</div></div><Pill>{row.latest_delivery_status || row.status}</Pill></div>{access.can("candidate.contact") && row.latest_direction === "outbound" && row.latest_approval_state !== "blocked" && row.latest_delivery_status !== "sent" ? <button type="button" onClick={() => void approveMessage(row)} className="mt-3 rounded-lg bg-indigo-600 px-3 py-2 text-[9px] font-semibold text-white">تأیید برای ارسال</button> : null}</div>) : <div className="p-5 text-[10px] text-slate-500">هنوز گفت‌وگویی ثبت نشده است.</div>}</div>
        </Panel>

        <Panel className="overflow-hidden">
          <div className="border-b border-slate-100 p-4"><h2 className="text-[12px] font-semibold">بررسی انسانی غربالگری</h2></div>
          <div className="divide-y divide-slate-100">{screening.length ? screening.map((row) => <div key={row.id} className="p-4"><div className="flex justify-between gap-3"><div><div className="text-[10px] font-semibold">{row.candidate_name || "کاندیدا"} · {row.job_title || "موقعیت شغلی"}</div><div className="mt-1 text-[9px] text-slate-500">Recommendation: {row.recommendation || "pending"}</div></div><Pill tone={row.review_state === "pending_human_review" ? "amber" : "green"}>{row.review_state}</Pill></div>{access.can("screening.manage") && row.review_state === "pending_human_review" ? <div className="mt-3 flex gap-2"><button type="button" onClick={() => void reviewScreening(row, "approved")} className="rounded-lg border border-slate-200 px-3 py-2 text-[9px]">تأیید نتیجه</button><button type="button" onClick={() => void reviewScreening(row, "overridden_advance")} className="rounded-lg bg-emerald-600 px-3 py-2 text-[9px] font-semibold text-white">تغییر به ادامه فرایند</button><button type="button" onClick={() => void reviewScreening(row, "overridden_reject")} className="rounded-lg bg-rose-600 px-3 py-2 text-[9px] font-semibold text-white">تغییر به رد</button></div> : null}</div>) : <div className="p-5 text-[10px] text-slate-500">نشست غربالگری وجود ندارد.</div>}</div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel className="overflow-hidden"><div className="border-b border-slate-100 p-4"><h2 className="text-[12px] font-semibold">چرخه زمان‌بندی</h2></div><div className="divide-y divide-slate-100">{scheduling.length ? scheduling.map((row) => <div key={row.id} className="flex items-center justify-between gap-3 p-4"><div><div className="text-[10px] font-semibold">{row.candidate_name || "کاندیدا"} · {row.interview_type}</div><div className="mt-1 text-[9px] text-slate-500">{row.job_title || "موقعیت شغلی"} · {row.selected_start ? new Date(row.selected_start).toLocaleString() : "در انتظار اعلام زمان‌های آزاد"}</div></div><div className="flex items-center gap-2"><Pill>{row.status}</Pill>{access.can("scheduling.manage") && row.status !== "cancelled" ? <button type="button" onClick={() => void cancelSchedule(row)} className="rounded-lg border border-slate-200 px-2 py-1 text-[9px]">لغو</button> : null}</div></div>) : <div className="p-5 text-[10px] text-slate-500">درخواست زمان‌بندی وجود ندارد.</div>}</div></Panel>
        <Panel className="overflow-hidden"><div className="border-b border-slate-100 p-4"><h2 className="text-[12px] font-semibold">محتوای دانشی و صف اعلان‌ها</h2></div><div className="p-4"><div className="space-y-2">{knowledge.length ? knowledge.slice(0, 8).map((item) => <div key={item.id} className="flex items-center justify-between rounded-lg border border-slate-100 p-2"><div><div className="text-[9px] font-semibold">{item.title}</div><div className="text-[8px] text-slate-400">{item.knowledge_type}</div></div><div className="flex items-center gap-2"><Pill>{faDomainLabel(item.status)}</Pill>{access.can("knowledge.manage") && item.status !== "approved" ? <button type="button" onClick={() => void approveKnowledge(item)} className="text-[9px] font-semibold text-indigo-600">تأیید</button> : null}</div></div>) : <div className="text-[10px] text-slate-500">محتوای دانشی وجود ندارد.</div>}</div><div className="mt-4 border-t border-slate-100 pt-3 text-[9px] text-slate-500">Notifications: {notifications.map((item) => `${item.notification_type}:${item.status}`).slice(0, 6).join(" · ") || "none"}</div></div></Panel>
      </div>
    </div>
  );
}

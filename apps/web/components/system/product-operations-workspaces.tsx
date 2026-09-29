"use client";

import type { components } from "@interview/api-client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, apiErrorMessage } from "../../lib/api";
import { faDomainLabel, formatFaDateTime } from "../../lib/i18n";
import { resolveTenantIdentity, tenantHeaders, type TenantIdentity } from "../../lib/tenant-client";
import { useInternalAccess } from "../product/internal-access";
import { Panel, Pill } from "../product/recruiting-ui";

type AutomationWorkspaceData = components["schemas"]["AutomationWorkspaceResponseDto"];
type AutomationRule = components["schemas"]["AutomationRuleResponseDto"];
type AutomationRun = components["schemas"]["AutomationRunResponseDto"];
type IntegrationRow = components["schemas"]["IntegrationConnectionResponseDto"];
type SettingsData = components["schemas"]["OrganizationSettingsResponseDto"];
type SearchRow = components["schemas"]["ProductSearchResultDto"];
type AuditRow = components["schemas"]["ProductAuditEventDto"];

function useIdentity() {
  const [identity, setIdentity] = useState<TenantIdentity>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    void resolveTenantIdentity()
      .then((value) => {
        if (active) setIdentity(value);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "بافت سازمان در دسترس نیست");
      });
    return () => {
      active = false;
    };
  }, []);
  return { identity, error };
}

export function AutomationsWorkspace() {
  const { identity, error } = useIdentity();
  const access = useInternalAccess();
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [message, setMessage] = useState<string>();
  const [loading, setLoading] = useState(true);

  async function load(current: TenantIdentity) {
    const result = await api.GET("/v1/automations", { headers: tenantHeaders(current) });
    if (!result.response.ok || !result.data) throw new Error(apiErrorMessage(result, "اتوماسیون‌ها بارگذاری نشدند"));
    const data: AutomationWorkspaceData = result.data;
    setRules(data.rules);
    setRuns(data.runs);
  }

  useEffect(() => {
    if (!identity) return;
    let active = true;
    void load(identity)
      .catch((reason: unknown) => {
        if (active) setMessage(reason instanceof Error ? reason.message : "بارگذاری ناموفق بود");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [identity]);

  async function createRule() {
    if (!identity) return;
    const name = window.prompt("نام اتوماسیون")?.trim();
    if (!name) return;
    const triggerType = window.prompt("نوع محرک", "application.stage_changed")?.trim();
    if (!triggerType) return;
    const actionType = window.prompt("نوع اقدام", "notification.create")?.trim();
    if (!actionType) return;
    const result = await api.POST("/v1/automations", {
      headers: tenantHeaders(identity, true),
      body: { name, triggerType, actionType, approvalRequired: true },
    });
    if (!result.response.ok) {
      setMessage(apiErrorMessage(result, "ایجاد ناموفق بود"));
      return;
    }
    setMessage("قانون اتوماسیون در حالت غیرفعال ایجاد شد و برای اجرا به تأیید انسانی نیاز دارد.");
    await load(identity);
  }

  async function toggle(rule: AutomationRule) {
    if (!identity) return;
    const result = await api.PATCH("/v1/automations/{ruleId}", {
      params: { path: { ruleId: rule.id } },
      headers: tenantHeaders(identity, true),
      body: { enabled: !rule.enabled },
    });
    if (!result.response.ok) {
      setMessage(apiErrorMessage(result, "به‌روزرسانی ناموفق بود"));
      return;
    }
    await load(identity);
  }

  async function run(rule: AutomationRule) {
    if (!identity) return;
    const result = await api.POST("/v1/automations/{ruleId}/runs", {
      params: { path: { ruleId: rule.id } },
      headers: tenantHeaders(identity, true),
      body: {
        idempotencyKey: `${rule.id}:${Date.now()}:${crypto.randomUUID()}`,
        triggerReference: "manual-ui-test",
        input: { source: "manual_ui" },
      },
    });
    if (!result.response.ok || !result.data) {
      setMessage(apiErrorMessage(result, "اجرای اتوماسیون ناموفق بود"));
      return;
    }
    setMessage(`اجرای اتوماسیون با وضعیت «${faDomainLabel(result.data.state)}» ثبت شد؛ اقدام خارجی فقط از مسیر سرویس‌های پیکربندی‌شده انجام می‌شود.`);
    await load(identity);
  }

  async function approve(runRow: AutomationRun) {
    if (!identity) return;
    const result = await api.POST("/v1/automation-runs/{runId}/approve", {
      params: { path: { runId: runRow.id } },
      headers: tenantHeaders(identity),
    });
    if (!result.response.ok) {
      setMessage(apiErrorMessage(result, "تأیید ناموفق بود"));
      return;
    }
    setMessage("اجرا تأیید و ثبت شد؛ اجرای واقعی همچنان تحت کنترل مرز سرویس و ارائه‌دهنده است.");
    await load(identity);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-[10px] font-medium text-indigo-600">هماهنگ‌سازی کنترل‌شده فرایندها</div>
          <h1 className="mt-2 text-[26px] font-semibold">اتوماسیون‌ها</h1>
          <p className="mt-1 text-[11px] text-slate-500">اجرای تکرارپذیر، تأیید صریح و بدون اقدام خارجی پنهان.</p>
        </div>
        {access.can("automation.manage") ? <button onClick={() => void createRule()} className="h-10 rounded-lg bg-indigo-600 px-4 text-[10px] font-semibold text-white">اتوماسیون جدید</button> : null}
      </div>
      {error || message ? <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-[10px] text-indigo-800">{error || message}</div> : null}
      <Panel className="overflow-hidden">
        <div className="border-b border-slate-100 p-4 text-[12px] font-semibold">قوانین</div>
        <div className="divide-y divide-slate-100">
          {loading ? <div className="p-5 text-[10px] text-slate-500">در حال بارگذاری قوانین اتوماسیون…</div> : rules.length ? rules.map((rule) => <div key={rule.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><div className="text-[10px] font-semibold">{rule.name}</div><div className="mt-1 text-[9px] text-slate-500">{rule.trigger_type} → {rule.action_type} · تأیید انسانی: {rule.approval_required ? "الزامی" : "غیرالزامی"}</div></div><div className="flex items-center gap-2"><Pill tone={rule.enabled ? "green" : "slate"}>{rule.enabled ? "فعال" : "غیرفعال"}</Pill><button onClick={() => void toggle(rule)} className="rounded-lg border border-slate-200 px-3 py-2 text-[9px]">{rule.enabled ? "غیرفعال‌کردن" : "فعال‌کردن"}</button><button disabled={!rule.enabled} onClick={() => void run(rule)} className="rounded-lg bg-indigo-600 px-3 py-2 text-[9px] font-semibold text-white disabled:opacity-40">ایجاد اجرا</button></div></div>) : <div className="p-5 text-[10px] text-slate-500">قانون اتوماسیونی وجود ندارد.</div>}
        </div>
      </Panel>
      <Panel className="overflow-hidden">
        <div className="border-b border-slate-100 p-4 text-[12px] font-semibold">اجراهای اخیر</div>
        <div className="divide-y divide-slate-100">{runs.slice(0, 30).map((row) => <div key={row.id} className="flex items-center justify-between gap-3 p-4"><div><div className="text-[9px] font-semibold">{row.idempotency_key}</div><div className="mt-1 text-[8px] text-slate-400">{formatFaDateTime(row.created_at)}</div></div><div className="flex items-center gap-2"><Pill tone={row.state === "failed" ? "red" : row.state === "approval_required" ? "amber" : "blue"}>{faDomainLabel(row.state)}</Pill>{row.state === "approval_required" ? <button onClick={() => void approve(row)} className="rounded-lg bg-emerald-600 px-3 py-2 text-[9px] font-semibold text-white">تأیید</button> : null}</div></div>)}</div>
      </Panel>
    </div>
  );
}

export function IntegrationsWorkspace() {
  const { identity, error } = useIdentity();
  const [rows, setRows] = useState<IntegrationRow[]>([]);
  const [message, setMessage] = useState<string>();
  const [loading, setLoading] = useState(true);

  async function load(current: TenantIdentity) {
    const result = await api.GET("/v1/integrations", { headers: tenantHeaders(current) });
    if (!result.response.ok || !result.data) throw new Error(apiErrorMessage(result, "یکپارچه‌سازی‌ها بارگذاری نشدند"));
    setRows(result.data);
  }

  useEffect(() => {
    if (!identity) return;
    let active = true;
    void load(identity)
      .catch((reason: unknown) => {
        if (active) setMessage(reason instanceof Error ? reason.message : "بارگذاری ناموفق بود");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [identity]);

  async function configure() {
    if (!identity) return;
    const providerKey = window.prompt("کلید ارائه‌دهنده (مثلاً greenhouse، google-calendar یا smtp)")?.trim();
    if (!providerKey) return;
    const connectionType = window.prompt("نوع اتصال", "api")?.trim();
    if (!connectionType) return;
    const credentialReference = window.prompt("فقط مرجع امن راز خارجی (مثلاً vault://interview/provider)")?.trim();
    if (!credentialReference) return;
    const result = await api.POST("/v1/integrations", {
      headers: tenantHeaders(identity, true),
      body: { providerKey, connectionType, credentialReference, config: {} },
    });
    if (!result.response.ok) {
      setMessage(apiErrorMessage(result, "پیکربندی ناموفق بود"));
      return;
    }
    setMessage("پیکربندی یکپارچه‌سازی با مرجع امن ذخیره شد و هیچ credential خامی ثبت نشد.");
    await load(identity);
  }

  async function setStatus(row: IntegrationRow, status: "configured" | "disabled") {
    if (!identity) return;
    const result = await api.PATCH("/v1/integrations/{integrationId}", {
      params: { path: { integrationId: row.id } },
      headers: tenantHeaders(identity, true),
      body: { status },
    });
    if (!result.response.ok) {
      setMessage(apiErrorMessage(result, "به‌روزرسانی ناموفق بود"));
      return;
    }
    await load(identity);
  }

  return <div className="space-y-5"><div className="flex items-end justify-between"><div><div className="text-[10px] font-medium text-indigo-600">مرز سازمانی مستقل از ارائه‌دهنده</div><h1 className="mt-2 text-[26px] font-semibold">یکپارچه‌سازی‌ها</h1><p className="mt-1 text-[11px] text-slate-500">ATS، تقویم، ایمیل و منابع خارجی مجاز با مرجع امن، وضعیت سلامت و حسابرسی مدیریت می‌شوند.</p></div><button onClick={() => void configure()} className="h-10 rounded-lg bg-indigo-600 px-4 text-[10px] font-semibold text-white">پیکربندی</button></div>{error || message ? <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-[10px] text-indigo-800">{error || message}</div> : null}<Panel className="overflow-hidden"><div className="divide-y divide-slate-100">{loading ? <div className="p-5 text-[10px] text-slate-500">در حال بارگذاری یکپارچه‌سازی‌ها…</div> : rows.length ? rows.map((row) => <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><div className="text-[10px] font-semibold">{row.provider_key} · {row.connection_type}</div><div className="mt-1 text-[9px] text-slate-500">Secret: {row.credential_reference || "پیکربندی نشده"}{row.last_error ? ` · ${row.last_error}` : ""}</div></div><div className="flex items-center gap-2"><Pill tone={row.status === "verified" ? "green" : row.status === "degraded" ? "amber" : "slate"}>{faDomainLabel(row.status)}</Pill><button onClick={() => void setStatus(row, row.status === "disabled" ? "configured" : "disabled")} className="rounded-lg border border-slate-200 px-3 py-2 text-[9px]">{row.status === "disabled" ? "فعال‌کردن" : "غیرفعال‌کردن"}</button></div></div>) : <div className="p-5 text-[10px] text-slate-500">یکپارچه‌سازی‌ای پیکربندی نشده است.</div>}</div></Panel><Panel className="p-4 text-[10px] leading-5 text-slate-600">اتصالی که فقط پیکربندی شده باشد تا زمان تأیید توسط adapter واقعی ارائه‌دهنده، «تأییدشده» محسوب نمی‌شود. توکن و رمز خام طبق سیاست API پذیرفته نمی‌شوند.</Panel></div>;
}

export function SettingsWorkspace() {
  const { identity, error } = useIdentity();
  const access = useInternalAccess();
  const [settings, setSettings] = useState<SettingsData>();
  const [message, setMessage] = useState<string>();
  const [loading, setLoading] = useState(true);

  async function load(current: TenantIdentity) {
    const result = await api.GET("/v1/settings", { headers: tenantHeaders(current) });
    if (!result.response.ok || !result.data) throw new Error(apiErrorMessage(result, "تنظیمات بارگذاری نشد"));
    setSettings(result.data);
  }

  useEffect(() => {
    if (!identity) return;
    let active = true;
    void load(identity)
      .catch((reason: unknown) => {
        if (active) setMessage(reason instanceof Error ? reason.message : "بارگذاری ناموفق بود");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [identity]);

  async function save() {
    if (!identity || !settings) return;
    const result = await api.PATCH("/v1/settings", {
      headers: tenantHeaders(identity, true),
      body: {
        defaultLocale: settings.default_locale || "fa",
        timezone: settings.timezone || "UTC",
        hiringPolicy: settings.hiring_policy || {},
        notificationPreferences: settings.notification_preferences || {},
      },
    });
    if (!result.response.ok || !result.data) {
      setMessage(apiErrorMessage(result, "ذخیره تنظیمات ناموفق بود"));
      return;
    }
    setSettings(result.data);
    setMessage("تنظیمات سازمان به‌روزرسانی و حسابرسی شد.");
  }

  return <div className="space-y-5"><div><div className="text-[10px] font-medium text-indigo-600">حاکمیت سازمان</div><h1 className="mt-2 text-[26px] font-semibold">تنظیمات</h1><p className="mt-1 text-[11px] text-slate-500">نقش‌ها و دسترسی‌ها، زبان و منطقه زمانی، حریم خصوصی و سیاست تصمیم انسانی.</p></div>{error || message ? <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-[10px] text-indigo-800">{error || message}</div> : null}{loading ? <Panel className="p-5 text-[10px] text-slate-500">در حال بارگذاری تنظیمات…</Panel> : <><div className="grid gap-4 xl:grid-cols-2"><Panel className="p-5"><h2 className="text-[12px] font-semibold">تنظیمات پیش‌فرض سازمان</h2><label className="mt-4 block text-[9px] font-semibold text-slate-500">زبان پیش‌فرض<input value={settings?.default_locale || ""} onChange={(event) => setSettings((current) => current ? { ...current, default_locale: event.target.value } : current)} className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-[10px]" /></label><label className="mt-3 block text-[9px] font-semibold text-slate-500">منطقه زمانی<input value={settings?.timezone || ""} onChange={(event) => setSettings((current) => current ? { ...current, timezone: event.target.value } : current)} className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-[10px]" /></label>{access.can("settings.manage") ? <button onClick={() => void save()} className="mt-4 h-9 rounded-lg bg-indigo-600 px-4 text-[9px] font-semibold text-white">ذخیره تنظیمات</button> : null}</Panel><Panel className="p-5"><h2 className="text-[12px] font-semibold">بخش‌های حاکمیتی</h2><div className="mt-4 grid gap-2"><Link href="/app/settings/users" className="rounded-lg border border-slate-200 p-3 text-[10px] font-semibold text-slate-700">کاربران و نقش‌ها</Link>{access.can("audit.read") ? <Link href="/app/settings/audit" className="rounded-lg border border-slate-200 p-3 text-[10px] font-semibold text-slate-700">مرور حسابرسی</Link> : null}<Link href="/app/analytics" className="rounded-lg border border-slate-200 p-3 text-[10px] font-semibold text-slate-700">تحلیل‌ها</Link></div></Panel></div><Panel className="p-5"><h2 className="text-[12px] font-semibold">اصول غیرقابل‌تغییر استخدام</h2><div className="mt-3 grid gap-2 md:grid-cols-3">{["شواهد پیش از امتیاز", "تصمیم و تغییر نتیجه توسط انسان", "عدم استنباط تناسب شغلی از چهره، بدن یا لهجه"].map((item) => <div key={item} className="rounded-lg bg-emerald-50 p-3 text-[9px] font-semibold text-emerald-800">{item}</div>)}</div></Panel></>}</div>;
}

export function SearchWorkspace({ initialQuery }: { initialQuery: string }) {
  const { identity, error } = useIdentity();
  const [query, setQuery] = useState(initialQuery);
  const [rows, setRows] = useState<SearchRow[]>([]);
  const [message, setMessage] = useState<string>();
  const [loading, setLoading] = useState(false);

  async function search(value = query) {
    if (!identity || value.trim().length < 2) return;
    setLoading(true);
    const result = await api.GET("/v1/search", {
      params: { query: { q: value.trim() } },
      headers: tenantHeaders(identity),
    });
    setLoading(false);
    if (!result.response.ok || !result.data) {
      setMessage(apiErrorMessage(result, "جستجو ناموفق بود"));
      return;
    }
    setRows(result.data);
    setMessage(undefined);
  }

  useEffect(() => {
    if (identity && initialQuery.trim().length >= 2) void search(initialQuery);
  }, [identity, initialQuery]);

  return <div className="space-y-5"><div><h1 className="text-[26px] font-semibold">جستجوی سراسری</h1><p className="mt-1 text-[11px] text-slate-500">جستجو در محدوده سازمان و بر اساس سطح دسترسی در موقعیت‌ها، کاندیداها و مصاحبه‌ها.</p></div><form onSubmit={(event) => { event.preventDefault(); void search(); }} className="flex gap-2"><input value={query} onChange={(event) => setQuery(event.target.value)} className="h-11 flex-1 rounded-lg border border-slate-200 px-4 text-[11px]" placeholder="جستجوی موقعیت، کاندیدا یا مصاحبه…" /><button className="rounded-lg bg-indigo-600 px-5 text-[10px] font-semibold text-white">جستجو</button></form>{error || message ? <div className="rounded-xl bg-rose-50 p-3 text-[10px] text-rose-700">{error || message}</div> : null}<Panel className="overflow-hidden"><div className="divide-y divide-slate-100">{loading ? <div className="p-5 text-[10px] text-slate-500">در حال جستجو…</div> : rows.map((row) => <Link key={`${row.type}:${row.id}`} href={row.href} className="flex items-center justify-between gap-3 p-4 hover:bg-slate-50"><div><div className="text-[10px] font-semibold text-slate-800">{row.title}</div><div className="mt-1 text-[9px] text-slate-500">{row.subtitle || row.type}</div></div><Pill>{faDomainLabel(row.type)}</Pill></Link>)}{!loading && query.trim().length >= 2 && !rows.length ? <div className="p-5 text-[10px] text-slate-500">نتیجه مجازی برای نمایش پیدا نشد.</div> : null}</div></Panel></div>;
}

export function AuditWorkspace() {
  const { identity, error } = useIdentity();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [action, setAction] = useState("");
  const [message, setMessage] = useState<string>();
  const [loading, setLoading] = useState(true);

  async function load(current = identity, filter = action) {
    if (!current) return;
    const query = filter.trim() ? { limit: 200, action: filter.trim() } : { limit: 200 };
    const result = await api.GET("/v1/audit/events", {
      params: { query },
      headers: tenantHeaders(current),
    });
    if (!result.response.ok || !result.data) {
      setMessage(apiErrorMessage(result, "رویدادهای حسابرسی بارگذاری نشدند"));
      return;
    }
    setRows(result.data);
    setMessage(undefined);
  }

  useEffect(() => {
    if (!identity) return;
    let active = true;
    void load(identity, "").finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [identity]);

  return <div className="space-y-5"><div><h1 className="text-[26px] font-semibold">مرور حسابرسی</h1><p className="mt-1 text-[11px] text-slate-500">تاریخچه عامل، اقدام و موجودیت برای عملیات حساس در محدوده سازمان.</p></div><form onSubmit={(event) => { event.preventDefault(); void load(identity, action); }} className="flex gap-2"><input value={action} onChange={(event) => setAction(event.target.value)} className="h-10 flex-1 rounded-lg border border-slate-200 px-3 text-[10px]" placeholder="فیلتر دقیق اقدام؛ مثلاً auth.login" /><button className="rounded-lg border border-slate-200 px-4 text-[9px] font-semibold">فیلتر</button></form>{error || message ? <div className="rounded-xl bg-rose-50 p-3 text-[10px] text-rose-700">{error || message}</div> : null}<Panel className="overflow-x-auto">{loading ? <div className="p-5 text-[10px] text-slate-500">در حال بارگذاری رویدادهای حسابرسی…</div> : <table className="w-full min-w-[900px] text-start text-[9px]"><thead className="bg-slate-50 text-slate-400"><tr><th className="p-3">زمان</th><th className="p-3">اقدام</th><th className="p-3">عامل</th><th className="p-3">موجودیت</th><th className="p-3">فراداده</th></tr></thead><tbody className="divide-y divide-slate-100">{rows.map((row) => <tr key={row.id}><td className="p-3">{formatFaDateTime(row.created_at)}</td><td className="p-3 font-semibold">{row.action}</td><td className="p-3">{faDomainLabel(row.actor_type)}:{row.actor_user_id || "سیستم"}</td><td className="p-3">{faDomainLabel(row.entity_type)}:{row.entity_id || "—"}</td><td className="max-w-[360px] truncate p-3 text-slate-500">{JSON.stringify(row.metadata || {})}</td></tr>)}</tbody></table>}</Panel></div>;
}

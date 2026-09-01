"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Panel, Pill } from "../product/recruiting-ui";
import { useInternalAccess } from "../product/internal-access";
import { resolveTenantIdentity, tenantHeaders, type TenantIdentity } from "../../lib/tenant-client";

async function api<T>(
  identity: TenantIdentity,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const hasBody = init.body !== undefined;
  const response = await fetch(`/api/backend${path}`, {
    ...init,
    headers: { ...tenantHeaders(identity, hasBody), ...(init.headers ?? {}) },
    credentials: "same-origin",
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) throw new Error(payload.message || `Request failed (${response.status})`);
  return payload;
}

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
        if (active) setError(reason instanceof Error ? reason.message : "Tenant context unavailable");
      });
    return () => {
      active = false;
    };
  }, []);
  return { identity, error };
}

interface AutomationRule {
  id: string;
  name: string;
  trigger_type: string;
  action_type: string;
  approval_required: boolean;
  enabled: boolean;
}
interface AutomationRun {
  id: string;
  rule_id: string;
  state: string;
  idempotency_key: string;
  created_at: string;
}

export function AutomationsWorkspace() {
  const { identity, error } = useIdentity();
  const access = useInternalAccess();
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [message, setMessage] = useState<string>();

  async function load(current: TenantIdentity) {
    const data = await api<{ rules: AutomationRule[]; runs: AutomationRun[] }>(current, "/v1/automations");
    setRules(data.rules);
    setRuns(data.runs);
  }

  useEffect(() => {
    if (!identity) return;
    void load(identity).catch((reason: unknown) => setMessage(reason instanceof Error ? reason.message : "Load failed"));
  }, [identity]);

  async function createRule() {
    if (!identity) return;
    const name = window.prompt("Automation name")?.trim();
    if (!name) return;
    const triggerType = window.prompt("Trigger type", "application.stage_changed")?.trim();
    if (!triggerType) return;
    const actionType = window.prompt("Action type", "notification.create")?.trim();
    if (!actionType) return;
    try {
      await api(identity, "/v1/automations", {
        method: "POST",
        body: JSON.stringify({ name, triggerType, actionType, approvalRequired: true }),
      });
      setMessage("Automation rule created disabled-by-default with human approval required.");
      await load(identity);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Create failed");
    }
  }

  async function toggle(rule: AutomationRule) {
    if (!identity) return;
    try {
      await api(identity, `/v1/automations/${rule.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      await load(identity);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Update failed");
    }
  }

  async function run(rule: AutomationRule) {
    if (!identity) return;
    try {
      const result = await api<{ state: string }>(identity, `/v1/automations/${rule.id}/runs`, {
        method: "POST",
        body: JSON.stringify({
          idempotencyKey: `${rule.id}:${Date.now()}:${crypto.randomUUID()}`,
          triggerReference: "manual-ui-test",
          input: { source: "manual_ui" },
        }),
      });
      setMessage(`Run persisted in state: ${result.state}. External actions remain behind configured workers/providers.`);
      await load(identity);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Run failed");
    }
  }

  async function approve(runRow: AutomationRun) {
    if (!identity) return;
    try {
      await api(identity, `/v1/automation-runs/${runRow.id}/approve`, { method: "POST" });
      setMessage("Run approved and recorded. Execution remains provider/worker-boundary controlled.");
      await load(identity);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Approval failed");
    }
  }

  return <div className="space-y-5"><div className="flex items-end justify-between gap-4"><div><div className="text-[10px] font-medium text-indigo-600">Controlled workflow orchestration</div><h1 className="mt-2 text-[26px] font-semibold">Automations</h1><p className="mt-1 text-[11px] text-slate-500">Idempotent runs, explicit approvals and no hidden external execution.</p></div>{access.can("automation.manage") ? <button onClick={() => void createRule()} className="h-10 rounded-lg bg-indigo-600 px-4 text-[10px] font-semibold text-white">New automation</button> : null}</div>{error || message ? <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-[10px] text-indigo-800">{error || message}</div> : null}<Panel className="overflow-hidden"><div className="border-b border-slate-100 p-4 text-[12px] font-semibold">Rules</div><div className="divide-y divide-slate-100">{rules.length ? rules.map((rule) => <div key={rule.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><div className="text-[10px] font-semibold">{rule.name}</div><div className="mt-1 text-[9px] text-slate-500">{rule.trigger_type} → {rule.action_type} · approval {rule.approval_required ? "required" : "not required"}</div></div><div className="flex items-center gap-2"><Pill tone={rule.enabled ? "green" : "slate"}>{rule.enabled ? "enabled" : "disabled"}</Pill><button onClick={() => void toggle(rule)} className="rounded-lg border border-slate-200 px-3 py-2 text-[9px]">{rule.enabled ? "Disable" : "Enable"}</button><button disabled={!rule.enabled} onClick={() => void run(rule)} className="rounded-lg bg-indigo-600 px-3 py-2 text-[9px] font-semibold text-white disabled:opacity-40">Create run</button></div></div>) : <div className="p-5 text-[10px] text-slate-500">No automation rules.</div>}</div></Panel><Panel className="overflow-hidden"><div className="border-b border-slate-100 p-4 text-[12px] font-semibold">Recent runs</div><div className="divide-y divide-slate-100">{runs.slice(0, 30).map((row) => <div key={row.id} className="flex items-center justify-between gap-3 p-4"><div><div className="text-[9px] font-semibold">{row.idempotency_key}</div><div className="mt-1 text-[8px] text-slate-400">{new Date(row.created_at).toLocaleString()}</div></div><div className="flex items-center gap-2"><Pill tone={row.state === "failed" ? "red" : row.state === "approval_required" ? "amber" : "blue"}>{row.state}</Pill>{row.state === "approval_required" ? <button onClick={() => void approve(row)} className="rounded-lg bg-emerald-600 px-3 py-2 text-[9px] font-semibold text-white">Approve</button> : null}</div></div>)}</div></Panel></div>;
}

interface IntegrationRow {
  id: string;
  provider_key: string;
  connection_type: string;
  status: string;
  credential_reference?: string;
  last_error?: string;
}

export function IntegrationsWorkspace() {
  const { identity, error } = useIdentity();
  const [rows, setRows] = useState<IntegrationRow[]>([]);
  const [message, setMessage] = useState<string>();
  async function load(current: TenantIdentity) {
    setRows(await api<IntegrationRow[]>(current, "/v1/integrations"));
  }
  useEffect(() => {
    if (identity) void load(identity).catch((reason: unknown) => setMessage(reason instanceof Error ? reason.message : "Load failed"));
  }, [identity]);
  async function configure() {
    if (!identity) return;
    const providerKey = window.prompt("Provider key (e.g. greenhouse, google-calendar, smtp)")?.trim();
    if (!providerKey) return;
    const connectionType = window.prompt("Connection type", "api")?.trim();
    if (!connectionType) return;
    const credentialReference = window.prompt("External secret reference only (e.g. vault://interview/provider)")?.trim();
    if (!credentialReference) return;
    try {
      await api(identity, "/v1/integrations", { method: "POST", body: JSON.stringify({ providerKey, connectionType, credentialReference, config: {} }) });
      setMessage("Integration configuration stored by reference; no raw credential persisted.");
      await load(identity);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Configuration failed");
    }
  }
  async function setStatus(row: IntegrationRow, status: string) {
    if (!identity) return;
    try {
      await api(identity, `/v1/integrations/${row.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      await load(identity);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Update failed");
    }
  }
  return <div className="space-y-5"><div className="flex items-end justify-between"><div><div className="text-[10px] font-medium text-indigo-600">Provider-neutral enterprise boundary</div><h1 className="mt-2 text-[26px] font-semibold">Integrations</h1><p className="mt-1 text-[11px] text-slate-500">ATS, calendar, email and approved external sources use secret references, health state and audit.</p></div><button onClick={() => void configure()} className="h-10 rounded-lg bg-indigo-600 px-4 text-[10px] font-semibold text-white">Configure</button></div>{error || message ? <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-[10px] text-indigo-800">{error || message}</div> : null}<Panel className="overflow-hidden"><div className="divide-y divide-slate-100">{rows.length ? rows.map((row) => <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><div className="text-[10px] font-semibold">{row.provider_key} · {row.connection_type}</div><div className="mt-1 text-[9px] text-slate-500">Secret: {row.credential_reference || "not configured"}{row.last_error ? ` · ${row.last_error}` : ""}</div></div><div className="flex items-center gap-2"><Pill tone={row.status === "verified" ? "green" : row.status === "degraded" ? "amber" : "slate"}>{row.status}</Pill><button onClick={() => void setStatus(row, row.status === "disabled" ? "configured" : "disabled")} className="rounded-lg border border-slate-200 px-3 py-2 text-[9px]">{row.status === "disabled" ? "Enable" : "Disable"}</button></div></div>) : <div className="p-5 text-[10px] text-slate-500">No integrations configured.</div>}</div></Panel><Panel className="p-4 text-[10px] leading-5 text-slate-600">A connection marked configured is not considered verified until the real provider adapter validates it. Raw tokens/passwords are rejected by API policy.</Panel></div>;
}

interface SettingsData {
  default_locale?: string;
  timezone?: string;
  hiring_policy?: Record<string, unknown>;
  notification_preferences?: Record<string, unknown>;
}

export function SettingsWorkspace() {
  const { identity, error } = useIdentity();
  const access = useInternalAccess();
  const [settings, setSettings] = useState<SettingsData>();
  const [message, setMessage] = useState<string>();
  async function load(current: TenantIdentity) {
    setSettings(await api<SettingsData>(current, "/v1/settings"));
  }
  useEffect(() => {
    if (identity) void load(identity).catch((reason: unknown) => setMessage(reason instanceof Error ? reason.message : "Load failed"));
  }, [identity]);
  async function save() {
    if (!identity || !settings) return;
    try {
      const updated = await api<SettingsData>(identity, "/v1/settings", { method: "PATCH", body: JSON.stringify({ defaultLocale: settings.default_locale || "en", timezone: settings.timezone || "UTC", hiringPolicy: settings.hiring_policy || {}, notificationPreferences: settings.notification_preferences || {} }) });
      setSettings(updated);
      setMessage("Organization settings updated and audited.");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Save failed");
    }
  }
  return <div className="space-y-5"><div><div className="text-[10px] font-medium text-indigo-600">Organization governance</div><h1 className="mt-2 text-[26px] font-semibold">Settings</h1><p className="mt-1 text-[11px] text-slate-500">RBAC, locale/timezone, privacy and human-decision policies.</p></div>{error || message ? <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-[10px] text-indigo-800">{error || message}</div> : null}<div className="grid gap-4 xl:grid-cols-2"><Panel className="p-5"><h2 className="text-[12px] font-semibold">Organization defaults</h2><label className="mt-4 block text-[9px] font-semibold text-slate-500">Default locale<input value={settings?.default_locale || ""} onChange={(event) => setSettings((current) => ({ ...(current ?? {}), default_locale: event.target.value }))} className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-[10px]" /></label><label className="mt-3 block text-[9px] font-semibold text-slate-500">Timezone<input value={settings?.timezone || ""} onChange={(event) => setSettings((current) => ({ ...(current ?? {}), timezone: event.target.value }))} className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-[10px]" /></label>{access.can("settings.manage") ? <button onClick={() => void save()} className="mt-4 h-9 rounded-lg bg-indigo-600 px-4 text-[9px] font-semibold text-white">Save settings</button> : null}</Panel><Panel className="p-5"><h2 className="text-[12px] font-semibold">Governance surfaces</h2><div className="mt-4 grid gap-2"><Link href="/app/settings/users" className="rounded-lg border border-slate-200 p-3 text-[10px] font-semibold text-slate-700">Users & roles</Link>{access.can("audit.read") ? <Link href="/app/settings/audit" className="rounded-lg border border-slate-200 p-3 text-[10px] font-semibold text-slate-700">Audit explorer</Link> : null}<Link href="/app/analytics" className="rounded-lg border border-slate-200 p-3 text-[10px] font-semibold text-slate-700">Analytics</Link></div></Panel></div><Panel className="p-5"><h2 className="text-[12px] font-semibold">Non-negotiable hiring policy</h2><div className="mt-3 grid gap-2 md:grid-cols-3">{["Evidence before score", "Human decision / override", "No face/body/accent suitability inference"].map((item) => <div key={item} className="rounded-lg bg-emerald-50 p-3 text-[9px] font-semibold text-emerald-800">{item}</div>)}</div></Panel></div>;
}

interface SearchRow { type: string; id: string; title: string; subtitle?: string; href: string }
export function SearchWorkspace({ initialQuery }: { initialQuery: string }) {
  const { identity, error } = useIdentity();
  const [query, setQuery] = useState(initialQuery);
  const [rows, setRows] = useState<SearchRow[]>([]);
  const [message, setMessage] = useState<string>();
  async function search(value = query) {
    if (!identity || value.trim().length < 2) return;
    try {
      setRows(await api<SearchRow[]>(identity, `/v1/search?q=${encodeURIComponent(value.trim())}`));
      setMessage(undefined);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Search failed");
    }
  }
  useEffect(() => {
    if (identity && initialQuery.trim().length >= 2) void search(initialQuery);
  }, [identity, initialQuery]);
  return <div className="space-y-5"><div><h1 className="text-[26px] font-semibold">Global search</h1><p className="mt-1 text-[11px] text-slate-500">Tenant-scoped and permission-filtered across jobs, candidates and interviews.</p></div><form onSubmit={(event) => { event.preventDefault(); void search(); }} className="flex gap-2"><input value={query} onChange={(event) => setQuery(event.target.value)} className="h-11 flex-1 rounded-lg border border-slate-200 px-4 text-[11px]" placeholder="Search jobs, candidates, interviews…" /><button className="rounded-lg bg-indigo-600 px-5 text-[10px] font-semibold text-white">Search</button></form>{error || message ? <div className="rounded-xl bg-rose-50 p-3 text-[10px] text-rose-700">{error || message}</div> : null}<Panel className="overflow-hidden"><div className="divide-y divide-slate-100">{rows.map((row) => <Link key={`${row.type}:${row.id}`} href={row.href} className="flex items-center justify-between gap-3 p-4 hover:bg-slate-50"><div><div className="text-[10px] font-semibold text-slate-800">{row.title}</div><div className="mt-1 text-[9px] text-slate-500">{row.subtitle || row.type}</div></div><Pill>{row.type}</Pill></Link>)}{query.trim().length >= 2 && !rows.length ? <div className="p-5 text-[10px] text-slate-500">No permitted results.</div> : null}</div></Panel></div>;
}

interface AuditRow { id: string; actor_type: string; actor_user_id?: string; action: string; entity_type: string; entity_id?: string; metadata?: Record<string, unknown>; created_at: string }
export function AuditWorkspace() {
  const { identity, error } = useIdentity();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [action, setAction] = useState("");
  const [message, setMessage] = useState<string>();
  async function load(current = identity, filter = action) {
    if (!current) return;
    try {
      setRows(await api<AuditRow[]>(current, `/v1/audit/events?limit=200${filter.trim() ? `&action=${encodeURIComponent(filter.trim())}` : ""}`));
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Audit load failed");
    }
  }
  useEffect(() => { if (identity) void load(identity, ""); }, [identity]);
  return <div className="space-y-5"><div><h1 className="text-[26px] font-semibold">Audit explorer</h1><p className="mt-1 text-[11px] text-slate-500">Organization-scoped actor/action/entity history for high-impact operations.</p></div><form onSubmit={(event) => { event.preventDefault(); void load(identity, action); }} className="flex gap-2"><input value={action} onChange={(event) => setAction(event.target.value)} className="h-10 flex-1 rounded-lg border border-slate-200 px-3 text-[10px]" placeholder="Exact action filter, e.g. auth.login" /><button className="rounded-lg border border-slate-200 px-4 text-[9px] font-semibold">Filter</button></form>{error || message ? <div className="rounded-xl bg-rose-50 p-3 text-[10px] text-rose-700">{error || message}</div> : null}<Panel className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-[9px]"><thead className="bg-slate-50 text-slate-400"><tr><th className="p-3">Time</th><th className="p-3">Action</th><th className="p-3">Actor</th><th className="p-3">Entity</th><th className="p-3">Metadata</th></tr></thead><tbody className="divide-y divide-slate-100">{rows.map((row) => <tr key={row.id}><td className="p-3">{new Date(row.created_at).toLocaleString()}</td><td className="p-3 font-semibold">{row.action}</td><td className="p-3">{row.actor_type}:{row.actor_user_id || "system"}</td><td className="p-3">{row.entity_type}:{row.entity_id || "—"}</td><td className="max-w-[360px] truncate p-3 text-slate-500">{JSON.stringify(row.metadata || {})}</td></tr>)}</tbody></table></Panel></div>;
}

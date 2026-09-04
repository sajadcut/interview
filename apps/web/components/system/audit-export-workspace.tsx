"use client";

import type { components } from "@interview/api-client";
import { useEffect, useState } from "react";
import { api, apiErrorMessage } from "../../lib/api";
import { resolveTenantIdentity, tenantHeaders, type TenantIdentity } from "../../lib/tenant-client";
import { useInternalAccess } from "../product/internal-access";
import { Panel, Pill } from "../product/recruiting-ui";

type AuditRow = components["schemas"]["ProductAuditEventDto"];
type AuditExport = components["schemas"]["AuditExportDto"];

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

function downloadJson(payload: AuditExport) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = `interview-audit-${new Date().toISOString().replaceAll(":", "-")}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}

export function AuditExportWorkspace() {
  const { identity, error } = useIdentity();
  const access = useInternalAccess();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [message, setMessage] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  async function load(current = identity, filter = action) {
    if (!current) return;
    const query = filter.trim() ? { limit: 200, action: filter.trim() } : { limit: 200 };
    const result = await api.GET("/v1/audit/events", {
      params: { query },
      headers: tenantHeaders(current),
    });
    if (!result.response.ok || !result.data) {
      setMessage(apiErrorMessage(result, "Audit load failed"));
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

  async function exportComplete() {
    if (!identity) return;
    setExporting(true);
    try {
      const query = {
        ...(from ? { from: new Date(from).toISOString() } : {}),
        ...(to ? { to: new Date(to).toISOString() } : {}),
        ...(action.trim() ? { action: action.trim() } : {}),
        ...(entityType.trim() ? { entityType: entityType.trim() } : {}),
      };
      const result = await api.GET("/v1/audit/export", {
        params: { query },
        headers: tenantHeaders(identity),
      });
      if (!result.response.ok || !result.data) {
        setMessage(apiErrorMessage(result, "Audit export failed"));
        return;
      }
      downloadJson(result.data);
      setMessage(`Complete audit export generated with ${result.data.count.toLocaleString()} records.`);
    } finally {
      setExporting(false);
    }
  }

  if (!access.can("audit.read")) {
    return <Panel className="p-5 text-[11px] text-slate-600">Audit access requires the organization audit.read permission.</Panel>;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[10px] font-medium text-indigo-600">Governance & decision provenance</div>
          <h1 className="mt-2 text-[26px] font-semibold">Audit explorer</h1>
          <p className="mt-1 max-w-3xl text-[11px] text-slate-500">
            Organization-scoped audit actions plus recruiting lifecycle, hiring decisions, evaluator provenance,
            score overrides, AI executions, consent, privacy and retention evidence.
          </p>
        </div>
        <button
          type="button"
          disabled={!identity || exporting}
          onClick={() => void exportComplete()}
          className="h-10 rounded-lg bg-indigo-600 px-4 text-[10px] font-semibold text-white disabled:opacity-40"
        >
          {exporting ? "Preparing export…" : "Download complete JSON"}
        </button>
      </div>

      <Panel className="p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-[9px] font-semibold text-slate-500">
            Exact action
            <input
              value={action}
              onChange={(event) => setAction(event.target.value)}
              className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-[10px] font-normal text-slate-800"
              placeholder="hiring.decision_recorded"
            />
          </label>
          <label className="text-[9px] font-semibold text-slate-500">
            Entity type
            <input
              value={entityType}
              onChange={(event) => setEntityType(event.target.value)}
              className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-[10px] font-normal text-slate-800"
              placeholder="application"
            />
          </label>
          <label className="text-[9px] font-semibold text-slate-500">
            From
            <input
              type="datetime-local"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-[10px] font-normal text-slate-800"
            />
          </label>
          <label className="text-[9px] font-semibold text-slate-500">
            To
            <input
              type="datetime-local"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-[10px] font-normal text-slate-800"
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-[9px] text-slate-500">
            Complete export omits a row limit by default; secrets/tokens/password-like fields are recursively redacted.
          </div>
          <button
            type="button"
            onClick={() => void load(identity, action)}
            className="rounded-lg border border-slate-200 px-4 py-2 text-[9px] font-semibold"
          >
            Refresh preview
          </button>
        </div>
      </Panel>

      {error || message ? (
        <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-[10px] text-indigo-800">
          {error || message}
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-3">
        <Panel className="p-4">
          <div className="text-[8px] uppercase tracking-[0.14em] text-slate-400">Preview rows</div>
          <div className="mt-2 text-[22px] font-semibold">{rows.length}</div>
        </Panel>
        <Panel className="p-4">
          <div className="text-[8px] uppercase tracking-[0.14em] text-slate-400">Export scope</div>
          <div className="mt-2 text-[11px] font-semibold">All supported audit ledgers</div>
        </Panel>
        <Panel className="p-4">
          <div className="text-[8px] uppercase tracking-[0.14em] text-slate-400">Integrity</div>
          <div className="mt-2 flex items-center gap-2 text-[11px] font-semibold"><Pill tone="green">SHA-256</Pill> manifest digest</div>
        </Panel>
      </div>

      <Panel className="overflow-x-auto">
        {loading ? (
          <div className="p-5 text-[10px] text-slate-500">Loading audit events…</div>
        ) : (
          <table className="w-full min-w-[900px] text-left text-[9px]">
            <thead className="bg-slate-50 text-slate-400">
              <tr>
                <th className="p-3">Time</th>
                <th className="p-3">Action</th>
                <th className="p-3">Actor</th>
                <th className="p-3">Entity</th>
                <th className="p-3">Metadata</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="p-3">{new Date(row.created_at).toLocaleString()}</td>
                  <td className="p-3 font-semibold">{row.action}</td>
                  <td className="p-3">{row.actor_type}:{row.actor_user_id || "system"}</td>
                  <td className="p-3">{row.entity_type}:{row.entity_id || "—"}</td>
                  <td className="max-w-[360px] truncate p-3 text-slate-500">{JSON.stringify(row.metadata || {})}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}

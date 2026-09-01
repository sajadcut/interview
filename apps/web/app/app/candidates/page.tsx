"use client";

import type { components } from "@interview/api-client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "../../../components/product/icon";
import { Panel, PersonAvatar, Pill } from "../../../components/product/recruiting-ui";
import { api } from "../../../lib/api";
import { resolveTenantIdentity, tenantHeaders } from "../../../lib/tenant-client";

type CandidateSummary = components["schemas"]["CandidateSummaryDto"];

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default function CandidatesPage() {
  const [candidates, setCandidates] = useState<CandidateSummary[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const identity = await resolveTenantIdentity();
        const result = await api.GET("/v1/candidates", { headers: tenantHeaders(identity) });
        if (result.error || !result.data) throw new Error("Candidates could not be loaded from the recruiting API");
        if (active) setCandidates(result.data);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Candidates could not be loaded");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const filteredCandidates = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return candidates;
    return candidates.filter((candidate) =>
      [candidate.displayName, candidate.currentRole, candidate.currentCompany, candidate.location, ...candidate.skills]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized)),
    );
  }, [candidates, query]);

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-1 text-[11px] font-medium text-indigo-600">Candidate intelligence</div>
        <h1 className="text-[28px] font-semibold tracking-[-.03em] text-slate-950">Candidates</h1>
        <p className="mt-1.5 text-[12px] text-slate-500">Organization-wide persisted talent intelligence and active hiring relationships.</p>
      </div>

      {error ? <div className="rounded-xl border border-rose-100 bg-rose-50 p-4 text-xs text-rose-700">{error}</div> : null}

      <Panel>
        <div className="border-b border-slate-200 p-4">
          <div className="relative min-w-[280px] flex-1">
            <Icon name="search" size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="h-10 w-full rounded-[10px] border border-slate-200 bg-slate-50 pl-10 pr-3 text-[11px] outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:bg-white focus:ring-4 focus:ring-indigo-50"
              placeholder="Search candidates by name, skill, company, role or location..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="data-table min-w-[980px]">
            <thead>
              <tr>
                {["Candidate", "Current Role", "Company", "Skills", "Location", "Updated"].map((heading) => (
                  <th key={heading}>{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="py-12 text-center text-slate-400">Loading persisted candidates…</td></tr>
              ) : filteredCandidates.length === 0 ? (
                <tr><td colSpan={6} className="py-12 text-center text-slate-400">{candidates.length ? "No candidates match this search." : "No candidates are available for this organization yet."}</td></tr>
              ) : filteredCandidates.map((candidate, index) => (
                <tr key={candidate.id}>
                  <td>
                    <Link href={`/app/candidates/${candidate.id}`} className="flex items-center gap-3">
                      <PersonAvatar name={candidate.displayName} size={32} tone={index % 5} />
                      <div>
                        <div className="font-semibold text-slate-900">{candidate.displayName}</div>
                        <div className="mt-1 text-[9px] text-slate-400">Persisted candidate intelligence profile</div>
                      </div>
                    </Link>
                  </td>
                  <td className="font-medium text-slate-700">{candidate.currentRole || "—"}</td>
                  <td>{candidate.currentCompany || "—"}</td>
                  <td>
                    <div className="flex max-w-[300px] flex-wrap gap-1">
                      {candidate.skills.length ? candidate.skills.slice(0, 4).map((skill) => <Pill key={skill}>{skill}</Pill>) : <span className="text-slate-400">No skills recorded</span>}
                    </div>
                  </td>
                  <td>{candidate.location || "—"}</td>
                  <td className="whitespace-nowrap">{formatUpdatedAt(candidate.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 text-[10px] text-slate-400">
          <span>{filteredCandidates.length} of {candidates.length} persisted candidates</span>
          <span>Pre-interview match remains application-specific and is shown inside a job workspace.</span>
        </div>
      </Panel>
    </div>
  );
}

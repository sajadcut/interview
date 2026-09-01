"use client";

import type { components } from "@interview/api-client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "../../../components/product/icon";
import { Panel, Pill, ToolbarButton } from "../../../components/product/recruiting-ui";
import { api } from "../../../lib/api";
import { resolveTenantIdentity, tenantHeaders } from "../../../lib/tenant-client";

type JobSummary = components["schemas"]["JobSummaryDto"];

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default function JobsPage() {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const identity = await resolveTenantIdentity();
        const result = await api.GET("/v1/jobs", { headers: tenantHeaders(identity) });
        if (result.error || !result.data) throw new Error("Jobs could not be loaded from the recruiting API");
        if (active) setJobs(result.data);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Jobs could not be loaded");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const filteredJobs = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return jobs;
    return jobs.filter((job) =>
      [job.title, job.department, job.location, job.seniority, job.status]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized)),
    );
  }, [jobs, query]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1 text-[11px] font-medium text-indigo-600">Hiring workspaces</div>
          <h1 className="text-[28px] font-semibold tracking-[-.03em] text-slate-950">Jobs</h1>
          <p className="mt-1.5 text-[12px] text-slate-500">Create, monitor and optimize persisted hiring workspaces.</p>
        </div>
        <Link href="/app/jobs/new">
          <ToolbarButton primary icon="plus">Create Job</ToolbarButton>
        </Link>
      </div>

      {error ? <div className="rounded-xl border border-rose-100 bg-rose-50 p-4 text-xs text-rose-700">{error}</div> : null}

      <Panel>
        <div className="border-b border-slate-200 p-4">
          <div className="relative min-w-[260px] flex-1">
            <Icon name="search" size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="h-10 w-full rounded-[10px] border border-slate-200 bg-slate-50 pl-10 pr-3 text-[11px] outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:bg-white focus:ring-4 focus:ring-indigo-50"
              placeholder="Search jobs by title, team, location or status..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="data-table min-w-[920px]">
            <thead>
              <tr>
                {["Job", "Department", "Location", "Candidates", "Interviews", "Status", "Updated"].map((heading) => (
                  <th key={heading}>{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="py-12 text-center text-slate-400">Loading persisted jobs…</td></tr>
              ) : filteredJobs.length === 0 ? (
                <tr><td colSpan={7} className="py-12 text-center text-slate-400">{jobs.length ? "No jobs match this search." : "No jobs have been created for this organization yet."}</td></tr>
              ) : filteredJobs.map((job) => (
                <tr key={job.id}>
                  <td>
                    <Link className="font-semibold text-slate-900 hover:text-indigo-600" href={`/app/jobs/${job.id}`}>
                      {job.title}
                    </Link>
                    <div className="mt-1 text-[9px] text-slate-400">{job.seniority || "Structured hiring workspace"}</div>
                  </td>
                  <td>{job.department || "—"}</td>
                  <td>{job.location || "—"}</td>
                  <td className="font-semibold text-slate-700">{job.applicationCount}</td>
                  <td className="font-semibold text-slate-700">{job.interviewCount}</td>
                  <td><Pill tone={job.status.toLowerCase() === "open" ? "green" : "amber"}>{job.status}</Pill></td>
                  <td className="whitespace-nowrap">{formatUpdatedAt(job.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-[10px] text-slate-400">
          <span>{filteredJobs.length} of {jobs.length} persisted jobs</span>
          <span className="font-medium text-slate-500">Sorted by recently updated</span>
        </div>
      </Panel>
    </div>
  );
}

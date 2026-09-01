"use client";

import type { components } from "@interview/api-client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { resolveTenantIdentity, tenantHeaders, type TenantIdentity } from "../../lib/tenant-client";
import { useInternalAccess } from "../product/internal-access";
import { Panel, Pill } from "../product/recruiting-ui";

type JobWorkspace = components["schemas"]["JobWorkspaceDto"];
type CandidateSummary = components["schemas"]["CandidateSummaryDto"];

function messageFrom(value: unknown, fallback: string): string {
  if (value && typeof value === "object" && "message" in value && typeof (value as { message?: unknown }).message === "string") {
    return String((value as { message: string }).message);
  }
  return fallback;
}

export function JobRecruitingWorkspace({ jobId }: { jobId: string }) {
  const access = useInternalAccess();
  const [identity, setIdentity] = useState<TenantIdentity>();
  const [job, setJob] = useState<JobWorkspace>();
  const [candidates, setCandidates] = useState<CandidateSummary[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string>();

  async function load(resolvedIdentity?: TenantIdentity) {
    const currentIdentity = resolvedIdentity ?? identity ?? (await resolveTenantIdentity());
    if (!identity) setIdentity(currentIdentity);
    const headers = tenantHeaders(currentIdentity);
    const [jobResult, candidatesResult] = await Promise.all([
      api.GET("/v1/jobs/{jobId}/workspace", {
        params: { path: { jobId } },
        headers,
      }),
      api.GET("/v1/candidates", {
        params: { query: { jobId } },
        headers,
      }),
    ]);
    if (jobResult.error || !jobResult.data) throw new Error(messageFrom(jobResult.error, "Job workspace could not be loaded"));
    setJob(jobResult.data);
    setCandidates(candidatesResult.error || !candidatesResult.data ? [] : candidatesResult.data);
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
        if (active) setMessage(error instanceof Error ? error.message : "Load failed");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [jobId]);

  async function publishRubric() {
    if (!identity) return;
    setMessage(undefined);
    const result = await api.POST("/v1/jobs/{jobId}/rubric/publish", {
      params: { path: { jobId } },
      headers: tenantHeaders(identity),
    });
    const payload = (result.data ?? result.error ?? {}) as { message?: string; version?: number };
    setMessage(result.error ? messageFrom(payload, "Publish failed") : `Rubric v${payload.version ?? ""} published.`);
    if (!result.error) await load(identity);
  }

  async function moveStage(applicationId: string, stage: string) {
    if (!identity) return;
    const reason = window.prompt(`Reason for moving to ${stage}`)?.trim();
    if (!reason) return;
    const result = await api.POST("/v1/applications/{applicationId}/stage", {
      params: { path: { applicationId } },
      headers: tenantHeaders(identity),
      body: { stage, reason },
    });
    setMessage(result.error ? messageFrom(result.error, "Stage move failed") : `Application moved to ${stage}.`);
    if (!result.error) await load(identity);
  }

  async function saveShortlist() {
    if (!identity || selected.size === 0) return;
    const entries = candidates
      .filter((candidate) => candidate.applicationId && selected.has(candidate.applicationId))
      .map((candidate, index) => ({ applicationId: candidate.applicationId!, rank: index + 1, rationale: "Human-selected shortlist entry" }));
    const result = await api.PUT("/v1/jobs/{jobId}/shortlist", {
      params: { path: { jobId } },
      headers: tenantHeaders(identity),
      body: { name: "Primary shortlist", status: "review", entries },
    });
    const payload = (result.data ?? result.error ?? {}) as { message?: string; entryCount?: number };
    setMessage(result.error ? messageFrom(payload, "Shortlist update failed") : `${payload.entryCount ?? entries.length} candidates saved to shortlist.`);
  }

  if (loading) return <div className="py-16 text-center text-sm text-slate-500">Loading job workspace…</div>;
  if (!job) return <div className="rounded-xl border border-rose-100 bg-rose-50 p-5 text-sm text-rose-700">{message || "Job not found"}</div>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[10px] text-slate-400">Jobs / {job.id}</div>
          <div className="mt-2 flex items-center gap-2"><h1 className="text-[24px] font-semibold tracking-tight">{job.title}</h1><Pill tone={job.status === "open" ? "green" : "slate"}>{job.status}</Pill></div>
          <p className="mt-1 text-[11px] text-slate-500">{[job.department, job.location, job.seniority].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="flex gap-2">
          {access.can("job.edit") ? <button type="button" onClick={() => void publishRubric()} className="h-10 rounded-[10px] border border-slate-200 bg-white px-4 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">Publish latest rubric</button> : null}
          {access.can("decision.submit") && selected.size > 0 ? <button type="button" onClick={() => void saveShortlist()} className="h-10 rounded-[10px] bg-indigo-600 px-4 text-[11px] font-semibold text-white">Save shortlist ({selected.size})</button> : null}
        </div>
      </div>

      {message ? <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-[10px] text-indigo-800">{message}</div> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <Panel className="p-5">
            <h2 className="text-[13px] font-semibold">Requirements</h2>
            <div className="mt-4 space-y-2">{job.requirements.length ? job.requirements.map((requirement) => <div key={requirement.id} className="flex items-start justify-between gap-3 rounded-xl border border-slate-100 p-3"><div><div className="text-[11px] font-semibold text-slate-800">{requirement.name}</div><div className="mt-1 text-[9px] text-slate-500">{requirement.requirementType.replaceAll("_", " ")}{requirement.minimumYears !== undefined ? ` · ${requirement.minimumYears}+ years` : ""}</div></div><span className="text-[9px] text-slate-400">weight {requirement.weight}</span></div>) : <div className="text-[10px] text-slate-400">No requirements yet.</div>}</div>
          </Panel>

          <Panel className="p-5">
            <h2 className="text-[13px] font-semibold">Candidates & pipeline</h2>
            <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[720px] text-left text-[10px]"><thead className="text-slate-400"><tr><th className="pb-2">Shortlist</th><th className="pb-2">Candidate</th><th className="pb-2">Stage</th><th className="pb-2">Match signal</th><th className="pb-2">Actions</th></tr></thead><tbody className="divide-y divide-slate-100">{candidates.map((candidate) => <tr key={candidate.id}><td className="py-3"><input type="checkbox" disabled={!candidate.applicationId || !access.can("decision.submit")} checked={Boolean(candidate.applicationId && selected.has(candidate.applicationId))} onChange={() => { if (!candidate.applicationId) return; setSelected((current) => { const next = new Set(current); if (next.has(candidate.applicationId!)) next.delete(candidate.applicationId!); else next.add(candidate.applicationId!); return next; }); }} /></td><td className="py-3"><Link href={`/app/candidates/${candidate.id}`} className="font-semibold text-slate-800 hover:text-indigo-600">{candidate.displayName}</Link><div className="mt-0.5 text-[9px] text-slate-400">{candidate.currentRole || candidate.currentCompany || "Candidate"}</div></td><td className="py-3"><Pill>{candidate.pipelineStage || "—"}</Pill></td><td className="py-3">{candidate.preInterviewMatchScore !== undefined ? `${candidate.preInterviewMatchScore}%` : "Not scored"}</td><td className="py-3"><div className="flex gap-1">{access.can("candidate.move_stage") && candidate.applicationId ? ["screening", "interview", "review"].map((stage) => <button key={stage} type="button" onClick={() => void moveStage(candidate.applicationId!, stage)} className="rounded-md border border-slate-200 px-2 py-1 text-[9px] hover:bg-slate-50">{stage}</button>) : null}</div></td></tr>)}</tbody></table></div>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel className="p-5">
            <h2 className="text-[13px] font-semibold">Rubric</h2>
            <div className="mt-4 space-y-2">{job.rubricCriteria.map((criterion) => <div key={criterion.id} className="rounded-xl bg-slate-50 p-3"><div className="flex items-center justify-between gap-2"><span className="text-[10px] font-semibold text-slate-800">{criterion.label}</span><span className="text-[9px] text-slate-400">{criterion.weight}</span></div><div className="mt-1 text-[9px] text-slate-500">{criterion.required ? "Required evidence" : "Optional"} · {criterion.criterionKey}</div></div>)}</div>
          </Panel>
          <Panel className="p-5"><h2 className="text-[13px] font-semibold">Pipeline distribution</h2><div className="mt-4 space-y-2">{job.pipeline.map((stage) => <div key={stage.stage} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-[10px]"><span>{stage.stage}</span><strong>{stage.count}</strong></div>)}</div></Panel>
        </div>
      </div>
    </div>
  );
}

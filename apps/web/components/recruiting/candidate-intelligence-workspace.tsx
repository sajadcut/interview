"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Panel, Pill } from "../product/recruiting-ui";
import { useInternalAccess } from "../product/internal-access";
import { resolveTenantIdentity, tenantHeaders, type TenantIdentity } from "../../lib/tenant-client";

interface CandidateWorkspacePayload {
  candidate: {
    id: string;
    displayName: string;
    primaryEmail?: string;
    primaryPhone?: string;
    currentRole?: string;
    currentCompany?: string;
    location?: string;
    preferredLanguage?: string;
  };
  experiences: Array<{ id: string; company: string; title: string; startedOn?: string; endedOn?: string; description?: string; sourceReference?: string }>;
  skills: Array<{ id: string; skillKey: string; skillLabel: string; verificationState: string; confidence?: number; sourceReference?: string }>;
  applications: Array<{
    id: string;
    jobId: string;
    jobTitle: string;
    status: string;
    pipelineStage: string;
    source?: string;
    preInterviewMatchScore?: number;
    scorecardId?: string;
    hiringScore?: number;
    recommendation?: string;
    decision?: string;
    decisionReason?: string;
  }>;
  evidence: Array<{ id: string; applicationId?: string; evidenceType: string; sourceType: string; sourceReference: string; excerpt?: string; occurredAt?: string; createdAt: string }>;
}

export function CandidateIntelligenceWorkspace({ candidateId }: { candidateId: string }) {
  const access = useInternalAccess();
  const [identity, setIdentity] = useState<TenantIdentity>();
  const [workspace, setWorkspace] = useState<CandidateWorkspacePayload>();
  const [selectedApplicationId, setSelectedApplicationId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string>();

  async function load(resolvedIdentity?: TenantIdentity) {
    const currentIdentity = resolvedIdentity ?? identity ?? (await resolveTenantIdentity());
    if (!identity) setIdentity(currentIdentity);
    const response = await fetch(`/api/backend/v1/candidates/${candidateId}/intelligence-workspace`, {
      headers: tenantHeaders(currentIdentity),
      credentials: "same-origin",
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => ({}))) as CandidateWorkspacePayload & { message?: string };
    if (!response.ok || !payload.candidate) throw new Error(payload.message || "Candidate workspace could not be loaded");
    setWorkspace(payload);
    setSelectedApplicationId((current) => current ?? payload.applications[0]?.id);
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
  }, [candidateId]);

  const selectedApplication = useMemo(
    () => workspace?.applications.find((application) => application.id === selectedApplicationId),
    [workspace, selectedApplicationId],
  );
  const applicationEvidence = useMemo(
    () => workspace?.evidence.filter((item) => !selectedApplicationId || item.applicationId === selectedApplicationId) ?? [],
    [workspace, selectedApplicationId],
  );

  async function finalizeScorecard() {
    if (!identity || !selectedApplicationId) return;
    const response = await fetch(`/api/backend/v1/applications/${selectedApplicationId}/scorecards/finalize`, {
      method: "POST",
      headers: tenantHeaders(identity),
      credentials: "same-origin",
    });
    const payload = (await response.json().catch(() => ({}))) as { persisted?: boolean; overallScore?: number | null; recommendation?: string; message?: string; missingEvaluationCriterionIds?: string[]; missingEvidenceCriterionIds?: string[] };
    if (!response.ok) {
      setMessage(payload.message || "Scorecard finalization failed");
      return;
    }
    if (!payload.persisted) {
      const missing = [...(payload.missingEvaluationCriterionIds ?? []), ...(payload.missingEvidenceCriterionIds ?? [])];
      setMessage(`Scorecard remains incomplete. Missing criterion evidence/evaluations: ${missing.length}.`);
      return;
    }
    setMessage(`Scorecard finalized: ${payload.overallScore ?? "—"} · ${payload.recommendation ?? ""}`);
    await load(identity);
  }

  async function addEvidence() {
    if (!identity || !selectedApplicationId) return;
    const excerpt = window.prompt("Evidence excerpt or concise paraphrase")?.trim();
    if (!excerpt) return;
    const sourceReference = window.prompt("Source reference (document, transcript timestamp, assessment id)")?.trim();
    if (!sourceReference) return;
    const response = await fetch(`/api/backend/v1/applications/${selectedApplicationId}/evidence`, {
      method: "POST",
      headers: tenantHeaders(identity, true),
      credentials: "same-origin",
      body: JSON.stringify({ evidenceType: "review_note", sourceType: "human_review", sourceReference, excerpt }),
    });
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    setMessage(response.ok ? "Evidence persisted." : payload.message || "Evidence creation failed");
    if (response.ok) await load(identity);
  }

  async function submitDecision(decision: "advance" | "hold" | "reject" | "hire") {
    if (!identity || !selectedApplicationId) return;
    const reason = window.prompt(`Human reason for ${decision}`)?.trim();
    if (!reason) return;
    const response = await fetch(`/api/backend/v1/applications/${selectedApplicationId}/decision`, {
      method: "POST",
      headers: tenantHeaders(identity, true),
      credentials: "same-origin",
      body: JSON.stringify({
        decision,
        reason,
        ...(selectedApplication?.scorecardId ? { scorecardId: selectedApplication.scorecardId } : {}),
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    setMessage(response.ok ? `Human decision recorded: ${decision}.` : payload.message || "Decision submission failed");
    if (response.ok) await load(identity);
  }

  if (loading) return <div className="py-16 text-center text-sm text-slate-500">Loading candidate intelligence…</div>;
  if (!workspace) return <div className="rounded-xl border border-rose-100 bg-rose-50 p-5 text-sm text-rose-700">{message || "Candidate not found"}</div>;

  const { candidate } = workspace;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[10px] text-slate-400">Candidates / {candidate.id}</div>
          <h1 className="mt-2 text-[24px] font-semibold tracking-tight text-slate-950">{candidate.displayName}</h1>
          <p className="mt-1 text-[11px] text-slate-500">{[candidate.currentRole, candidate.currentCompany, candidate.location].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {access.can("candidate.score") && selectedApplicationId ? <button type="button" onClick={() => void addEvidence()} className="h-10 rounded-[10px] border border-slate-200 bg-white px-4 text-[11px] font-semibold">Add evidence</button> : null}
          {access.can("candidate.score") && selectedApplicationId ? <button type="button" onClick={() => void finalizeScorecard()} className="h-10 rounded-[10px] bg-indigo-600 px-4 text-[11px] font-semibold text-white">Finalize scorecard</button> : null}
        </div>
      </div>

      {message ? <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-[10px] text-indigo-800">{message}</div> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
        <div className="space-y-4">
          <Panel className="p-5">
            <h2 className="text-[13px] font-semibold">Applications & job matches</h2>
            <div className="mt-4 grid gap-2">{workspace.applications.map((application) => <button key={application.id} type="button" onClick={() => setSelectedApplicationId(application.id)} className={`w-full rounded-xl border p-3 text-left transition ${application.id === selectedApplicationId ? "border-indigo-200 bg-indigo-50" : "border-slate-100 hover:bg-slate-50"}`}><div className="flex flex-wrap items-center justify-between gap-2"><div><div className="text-[11px] font-semibold text-slate-800">{application.jobTitle}</div><div className="mt-1 text-[9px] text-slate-500">{application.pipelineStage} · {application.status}</div></div><div className="flex items-center gap-2">{application.preInterviewMatchScore !== undefined ? <Pill tone="blue">Match {application.preInterviewMatchScore}%</Pill> : null}{application.hiringScore !== undefined ? <Pill tone="violet">Hiring {application.hiringScore}</Pill> : <Pill>Hiring score incomplete</Pill>}</div></div>{application.decision ? <div className="mt-2 text-[9px] text-slate-600">Latest human decision: <strong>{application.decision}</strong>{application.decisionReason ? ` — ${application.decisionReason}` : ""}</div> : null}</button>)}</div>
          </Panel>

          <Panel className="p-5">
            <h2 className="text-[13px] font-semibold">Experience</h2>
            <div className="mt-4 space-y-3">{workspace.experiences.length ? workspace.experiences.map((experience) => <div key={experience.id} className="rounded-xl border border-slate-100 p-3"><div className="text-[11px] font-semibold text-slate-800">{experience.title} · {experience.company}</div><div className="mt-1 text-[9px] text-slate-400">{experience.startedOn || "?"} → {experience.endedOn || "Present"}</div>{experience.description ? <p className="mt-2 text-[10px] leading-5 text-slate-600">{experience.description}</p> : null}{experience.sourceReference ? <div className="mt-2 text-[8px] text-slate-400">Source: {experience.sourceReference}</div> : null}</div>) : <div className="text-[10px] text-slate-400">No persisted experience records.</div>}</div>
          </Panel>

          <Panel className="p-5">
            <h2 className="text-[13px] font-semibold">Evidence for selected application</h2>
            <div className="mt-4 space-y-2">{applicationEvidence.length ? applicationEvidence.map((item) => <div key={item.id} className="rounded-xl border border-slate-100 p-3"><div className="flex items-center justify-between"><Pill>{item.evidenceType}</Pill><span className="text-[8px] text-slate-400">{item.sourceType}</span></div>{item.excerpt ? <p className="mt-2 text-[10px] leading-5 text-slate-700">{item.excerpt}</p> : null}<div className="mt-2 text-[8px] text-slate-400">{item.sourceReference}</div></div>) : <div className="rounded-xl bg-amber-50 p-3 text-[10px] text-amber-800">No evidence persisted for this application. Hiring score must remain incomplete.</div>}</div>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel className="p-5">
            <h2 className="text-[13px] font-semibold">Identity & contact</h2>
            <dl className="mt-4 space-y-3 text-[10px]"><div><dt className="text-slate-400">Email</dt><dd className="mt-1 text-slate-700">{candidate.primaryEmail || "—"}</dd></div><div><dt className="text-slate-400">Phone</dt><dd className="mt-1 text-slate-700">{candidate.primaryPhone || "—"}</dd></div><div><dt className="text-slate-400">Language</dt><dd className="mt-1 text-slate-700">{candidate.preferredLanguage || "—"}</dd></div></dl>
          </Panel>

          <Panel className="p-5">
            <h2 className="text-[13px] font-semibold">Skills & verification</h2>
            <div className="mt-4 flex flex-wrap gap-2">{workspace.skills.map((skill) => <span key={skill.id} title={skill.sourceReference} className={`rounded-full px-2.5 py-1 text-[9px] font-semibold ${skill.verificationState === "verified" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{skill.skillLabel} · {skill.verificationState}</span>)}</div>
          </Panel>

          {selectedApplication ? <Panel className="p-5"><h2 className="text-[13px] font-semibold">Human decision control</h2><p className="mt-2 text-[9px] leading-4 text-slate-500">AI recommendations are decision support only. A human actor and reason are persisted for every decision.</p><div className="mt-4 grid grid-cols-2 gap-2">{access.can("decision.submit") ? (["advance", "hold", "reject", "hire"] as const).map((decision) => <button key={decision} type="button" onClick={() => void submitDecision(decision)} className={`rounded-lg border px-3 py-2 text-[10px] font-semibold ${decision === "reject" ? "border-rose-100 text-rose-700" : decision === "hire" ? "border-emerald-100 text-emerald-700" : "border-slate-200 text-slate-700"}`}>{decision}</button>) : <div className="col-span-2 rounded-lg bg-slate-50 p-3 text-[9px] text-slate-500">Current role cannot submit hiring decisions.</div>}</div><Link href={`/app/jobs/${selectedApplication.jobId}`} className="mt-4 inline-flex text-[9px] font-semibold text-indigo-600">Open job workspace →</Link></Panel> : null}
        </div>
      </div>
    </div>
  );
}

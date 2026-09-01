"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { resolveTenantIdentity, tenantHeaders, type TenantIdentity } from "../../lib/tenant-client";

type Detail = {
  assignment: { id: string; status: string; scheduledFor?: string };
  session: { id: string; status: string; startedAt?: string; completedAt?: string; remainingSeconds: number | null };
  application: { id: string; pipelineStage: string };
  candidate: { id: string; displayName: string; currentRole?: string; currentCompany?: string; location?: string };
  job: { id: string; title: string };
  plan: { id: string; language: string; interviewType: string; timeBudgetMinutes: number };
};

type Note = { id: string; body: string; authorName?: string; createdAt?: string };

function message(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "message" in payload) {
    const value = (payload as { message?: unknown }).message;
    if (typeof value === "string") return value;
  }
  return fallback;
}

export function InterviewerSession({ sessionId }: { sessionId: string }) {
  const [identity, setIdentity] = useState<TenantIdentity | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [note, setNote] = useState("");
  const [recommendation, setRecommendation] = useState("mixed");
  const [evidenceSummary, setEvidenceSummary] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    const current = identity ?? (await resolveTenantIdentity());
    if (!identity) setIdentity(current);
    const response = await fetch(path, {
      ...init,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        ...tenantHeaders(current, init.body !== undefined),
        ...init.headers,
      },
    });
    if (response.status === 401) {
      window.location.replace("/login");
      throw new Error("Authentication is required");
    }
    const payload = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) throw new Error(message(payload, `Request failed with ${response.status}`));
    return payload;
  }, [identity]);

  const load = useCallback(async () => {
    const [detailPayload, notesPayload] = await Promise.all([
      request(`/api/backend/v1/interviewer/interviews/${sessionId}`),
      request(`/api/backend/v1/interviewer/interviews/${sessionId}/notes`),
    ]);
    setDetail(detailPayload as Detail);
    setNotes(notesPayload as Note[]);
  }, [request, sessionId]);

  useEffect(() => {
    load().catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load interview"));
  }, [load]);

  async function action(name: "start" | "complete") {
    setBusy(true);
    setError(null);
    try {
      await request(`/api/backend/v1/interviewer/interviews/${sessionId}/${name}`, { method: "POST" });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Unable to ${name} interview`);
    } finally {
      setBusy(false);
    }
  }

  async function submitNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!note.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await request(`/api/backend/v1/interviewer/interviews/${sessionId}/notes`, {
        method: "POST",
        body: JSON.stringify({ body: note.trim() }),
      });
      setNote("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save note");
    } finally {
      setBusy(false);
    }
  }

  async function submitEvaluation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!evidenceSummary.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await request(`/api/backend/v1/interviewer/interviews/${sessionId}/evaluation`, {
        method: "POST",
        body: JSON.stringify({
          recommendation,
          criterionResults: [{
            criterionKey: "interviewer_summary",
            rationale: evidenceSummary.trim(),
            source: "human_interviewer",
          }],
        }),
      });
      setEvidenceSummary("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to submit evaluation");
    } finally {
      setBusy(false);
    }
  }

  if (!detail) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-500">{error ?? "Loading interview…"}</div>;
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[.14em] text-indigo-600">Assigned interview</div>
            <h1 className="mt-1 text-2xl font-semibold tracking-[-.03em] text-slate-950">{detail.candidate.displayName}</h1>
            <p className="mt-1 text-xs text-slate-500">{detail.job.title} · {detail.plan.interviewType} · {detail.plan.language}</p>
          </div>
          <div className="rounded-full bg-slate-100 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[.06em] text-slate-600">{detail.session.status.replaceAll("_", " ")}</div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-slate-50 p-3 text-xs"><div className="text-[10px] text-slate-400">Current role</div><div className="mt-1 font-semibold text-slate-700">{detail.candidate.currentRole ?? "Not provided"}</div></div>
          <div className="rounded-xl bg-slate-50 p-3 text-xs"><div className="text-[10px] text-slate-400">Company</div><div className="mt-1 font-semibold text-slate-700">{detail.candidate.currentCompany ?? "Not provided"}</div></div>
          <div className="rounded-xl bg-slate-50 p-3 text-xs"><div className="text-[10px] text-slate-400">Time budget</div><div className="mt-1 font-semibold text-slate-700">{detail.plan.timeBudgetMinutes} minutes</div></div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <button disabled={busy || !["invited", "scheduled"].includes(detail.session.status)} onClick={() => action("start")} className="rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-40" type="button">Start interview</button>
          <button disabled={busy || detail.session.status !== "in_progress"} onClick={() => action("complete")} className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-semibold text-slate-800 disabled:opacity-40" type="button">Complete interview</button>
        </div>
      </section>

      {error ? <div className="rounded-xl border border-red-100 bg-red-50 p-3 text-xs text-red-700">{error}</div> : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Internal notes</h2>
          <p className="mt-1 text-[11px] text-slate-500">Notes are internal and never shown to the candidate.</p>
          <form className="mt-4" onSubmit={submitNote}>
            <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={10000} className="min-h-28 w-full rounded-xl border border-slate-200 p-3 text-xs outline-none focus:border-indigo-400" placeholder="Record observable evidence or interview context…" />
            <button disabled={busy || !note.trim()} className="mt-2 rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40" type="submit">Save note</button>
          </form>
          <div className="mt-4 space-y-2">
            {notes.map((item) => <div key={item.id} className="rounded-xl border border-slate-100 p-3 text-xs text-slate-700"><div>{item.body}</div><div className="mt-2 text-[10px] text-slate-400">{item.authorName ?? "Interviewer"}{item.createdAt ? ` · ${new Date(item.createdAt).toLocaleString()}` : ""}</div></div>)}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Submit evaluation</h2>
          <p className="mt-1 text-[11px] leading-5 text-slate-500">Provide evidence-linked human feedback. This does not bypass the final human hiring decision.</p>
          <form className="mt-4 space-y-3" onSubmit={submitEvaluation}>
            <label className="block text-xs font-medium text-slate-700">Recommendation
              <select value={recommendation} onChange={(event) => setRecommendation(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs">
                <option value="strong_yes">Strong yes</option><option value="yes">Yes</option><option value="mixed">Mixed</option><option value="no">No</option><option value="strong_no">Strong no</option>
              </select>
            </label>
            <label className="block text-xs font-medium text-slate-700">Evidence summary
              <textarea value={evidenceSummary} onChange={(event) => setEvidenceSummary(event.target.value)} className="mt-1.5 min-h-32 w-full rounded-xl border border-slate-200 p-3 text-xs outline-none focus:border-indigo-400" placeholder="Describe specific answers, examples, or evidence supporting the evaluation." required />
            </label>
            <button disabled={busy || !evidenceSummary.trim()} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-40" type="submit">Submit evaluation</button>
          </form>
        </section>
      </div>
    </div>
  );
}

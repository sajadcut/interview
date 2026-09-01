"use client";

import { useCallback, useEffect, useState } from "react";
import { resolveTenantIdentity, tenantHeaders, type TenantIdentity } from "../../lib/tenant-client";

type InterviewerOption = { userId: string; email: string; displayName?: string };
type SessionOption = {
  sessionId: string;
  sessionStatus: string;
  applicationId: string;
  candidateName: string;
  jobTitle: string;
  interviewerUserId?: string;
  interviewerName?: string;
  interviewerEmail?: string;
  assignmentStatus?: string;
  scheduledFor?: string;
};

type Options = { sessions: SessionOption[]; interviewers: InterviewerOption[] };

function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "message" in payload) {
    const value = (payload as { message?: unknown }).message;
    if (typeof value === "string") return value;
  }
  return fallback;
}

export function InterviewOperations() {
  const [identity, setIdentity] = useState<TenantIdentity | null>(null);
  const [options, setOptions] = useState<Options>({ sessions: [], interviewers: [] });
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busySession, setBusySession] = useState<string | null>(null);

  const load = useCallback(async () => {
    const current = identity ?? (await resolveTenantIdentity());
    if (!identity) setIdentity(current);
    const response = await fetch("/api/backend/v1/interview-operations/assignment-options", {
      credentials: "same-origin",
      cache: "no-store",
      headers: tenantHeaders(current),
    });
    if (response.status === 401) {
      window.location.replace("/login");
      return;
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(errorMessage(payload, "Unable to load interview operations"));
    const data = payload as Options;
    setOptions(data);
    setSelected((previous) => {
      const next = { ...previous };
      for (const session of data.sessions) {
        if (!next[session.sessionId] && session.interviewerUserId) next[session.sessionId] = session.interviewerUserId;
      }
      return next;
    });
  }, [identity]);

  useEffect(() => {
    load().catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load interview operations"));
  }, [load]);

  async function assign(sessionId: string) {
    const interviewerUserId = selected[sessionId];
    if (!interviewerUserId) return setError("Choose an interviewer first");
    const current = identity ?? (await resolveTenantIdentity());
    setBusySession(sessionId);
    setError(null);
    try {
      const response = await fetch("/api/backend/v1/interviewer/assignments", {
        method: "POST",
        credentials: "same-origin",
        headers: tenantHeaders(current, true),
        body: JSON.stringify({ sessionId, interviewerUserId }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorMessage(payload, "Unable to assign interviewer"));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to assign interviewer");
    } finally {
      setBusySession(null);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[24px] font-semibold tracking-[-.03em] text-slate-950">Interviews</h1>
        <p className="mt-1 text-[11px] text-slate-500">Real interview sessions, interviewer assignments, schedules and review state.</p>
      </div>
      {error ? <div className="rounded-xl border border-red-100 bg-red-50 p-3 text-xs text-red-700">{error}</div> : null}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-[.06em] text-slate-400">
              <tr><th className="px-5 py-3">Candidate</th><th className="px-3 py-3">Job</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Scheduled</th><th className="px-3 py-3">Interviewer</th><th className="px-5 py-3 text-right">Action</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {options.sessions.map((session) => (
                <tr key={session.sessionId}>
                  <td className="px-5 py-4 font-semibold text-slate-800">{session.candidateName}</td>
                  <td className="px-3 py-4 text-slate-600">{session.jobTitle}</td>
                  <td className="px-3 py-4"><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold uppercase text-slate-600">{session.sessionStatus.replaceAll("_", " ")}</span></td>
                  <td className="px-3 py-4 text-slate-500">{session.scheduledFor ? new Date(session.scheduledFor).toLocaleString() : "Not scheduled"}</td>
                  <td className="px-3 py-4">
                    <select value={selected[session.sessionId] ?? ""} onChange={(event) => setSelected((state) => ({ ...state, [session.sessionId]: event.target.value }))} className="w-full min-w-48 rounded-lg border border-slate-200 bg-white px-2 py-2 text-[11px]">
                      <option value="">Choose interviewer</option>
                      {options.interviewers.map((interviewer) => <option key={interviewer.userId} value={interviewer.userId}>{interviewer.displayName || interviewer.email}</option>)}
                    </select>
                  </td>
                  <td className="px-5 py-4 text-right"><button disabled={busySession === session.sessionId || !selected[session.sessionId]} onClick={() => assign(session.sessionId)} className="rounded-lg bg-slate-950 px-3 py-2 text-[11px] font-semibold text-white disabled:opacity-40" type="button">{busySession === session.sessionId ? "Assigning…" : session.interviewerUserId ? "Reassign" : "Assign"}</button></td>
                </tr>
              ))}
              {options.sessions.length === 0 ? <tr><td colSpan={6} className="px-5 py-10 text-center text-slate-400">No interview sessions found.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

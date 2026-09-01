"use client";

import { useCallback, useEffect, useState } from "react";
import { api, apiErrorMessage } from "../../lib/api";
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

export function InterviewOperations() {
  const [identity, setIdentity] = useState<TenantIdentity | null>(null);
  const [options, setOptions] = useState<Options>({ sessions: [], interviewers: [] });
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busySession, setBusySession] = useState<string | null>(null);

  const load = useCallback(async () => {
    const current = identity ?? (await resolveTenantIdentity());
    if (!identity) setIdentity(current);
    const result = await api.GET("/v1/interview-operations/assignment-options", {
      headers: tenantHeaders(current),
    });
    if (result.response.status === 401) {
      window.location.replace("/login");
      return;
    }
    if (!result.response.ok) {
      throw new Error(apiErrorMessage(result, "Unable to load interview operations"));
    }
    const data = result.data as Options;
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
    let active = true;
    void load()
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to load interview operations");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [load]);

  async function assign(sessionId: string) {
    const interviewerUserId = selected[sessionId];
    if (!interviewerUserId) {
      setError("Choose an interviewer first");
      return;
    }
    const current = identity ?? (await resolveTenantIdentity());
    setBusySession(sessionId);
    setError(null);
    try {
      const result = await api.POST("/v1/interviewer/assignments", {
        headers: tenantHeaders(current),
        body: { sessionId, interviewerUserId },
      });
      if (!result.response.ok) {
        throw new Error(apiErrorMessage(result, "Unable to assign interviewer"));
      }
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
      {error ? <div role="alert" className="rounded-xl border border-red-100 bg-red-50 p-3 text-xs text-red-700">{error}</div> : null}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-[.06em] text-slate-400">
              <tr><th className="px-5 py-3">Candidate</th><th className="px-3 py-3">Job</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Scheduled</th><th className="px-3 py-3">Interviewer</th><th className="px-5 py-3 text-right">Action</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? <tr><td colSpan={6} className="px-5 py-10 text-center text-slate-400">Loading interview operations…</td></tr> : options.sessions.map((session) => (
                <tr key={session.sessionId}>
                  <td className="px-5 py-4 font-semibold text-slate-800">{session.candidateName}</td>
                  <td className="px-3 py-4 text-slate-600">{session.jobTitle}</td>
                  <td className="px-3 py-4"><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold uppercase text-slate-600">{session.sessionStatus.replaceAll("_", " ")}</span></td>
                  <td className="px-3 py-4 text-slate-500">{session.scheduledFor ? new Date(session.scheduledFor).toLocaleString() : "Not scheduled"}</td>
                  <td className="px-3 py-4">
                    <label className="sr-only" htmlFor={`interviewer-${session.sessionId}`}>Interviewer for {session.candidateName}</label>
                    <select id={`interviewer-${session.sessionId}`} value={selected[session.sessionId] ?? ""} onChange={(event) => setSelected((state) => ({ ...state, [session.sessionId]: event.target.value }))} className="w-full min-w-48 rounded-lg border border-slate-200 bg-white px-2 py-2 text-[11px]">
                      <option value="">Choose interviewer</option>
                      {options.interviewers.map((interviewer) => <option key={interviewer.userId} value={interviewer.userId}>{interviewer.displayName || interviewer.email}</option>)}
                    </select>
                  </td>
                  <td className="px-5 py-4 text-right"><button disabled={busySession === session.sessionId || !selected[session.sessionId]} onClick={() => void assign(session.sessionId)} className="rounded-lg bg-slate-950 px-3 py-2 text-[11px] font-semibold text-white disabled:opacity-40" type="button">{busySession === session.sessionId ? "Assigning…" : session.interviewerUserId ? "Reassign" : "Assign"}</button></td>
                </tr>
              ))}
              {!loading && options.sessions.length === 0 ? <tr><td colSpan={6} className="px-5 py-10 text-center text-slate-400">No interview sessions found.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

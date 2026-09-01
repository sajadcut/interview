"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";

interface AssessmentSession {
  session_id: string;
  status: string;
  title: string;
  instructions: string;
  assessment_type: string;
  time_limit_minutes?: number;
  job_title: string;
  result_status?: string;
  normalized_score?: number;
  review_state?: string;
}

function messageFrom(value: unknown, fallback: string): string {
  if (value && typeof value === "object" && "message" in value) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string") return message;
    if (Array.isArray(message)) return message.map(String).join("; ");
  }
  return fallback;
}

export function CandidateAssessments() {
  const [sessions, setSessions] = useState<AssessmentSession[]>([]);
  const [selected, setSelected] = useState<AssessmentSession>();
  const [sourceText, setSourceText] = useState("");
  const [language, setLanguage] = useState("typescript");
  const [message, setMessage] = useState<string>();
  const [loading, setLoading] = useState(true);

  async function load() {
    const result = await api.GET("/v1/candidate/assessments");
    if (result.response.status === 401) {
      window.location.href = "/candidate/login";
      return;
    }
    if (result.error) throw new Error(messageFrom(result.error, "Assessments could not be loaded"));
    const payload = result.data as { sessions?: AssessmentSession[] } | undefined;
    setSessions(payload?.sessions ?? []);
  }

  useEffect(() => {
    let active = true;
    void load()
      .catch((reason: unknown) => {
        if (active) setMessage(reason instanceof Error ? reason.message : "Assessment load failed");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function start(session: AssessmentSession) {
    const result = await api.POST("/v1/candidate/assessments/{sessionId}/start", {
      params: { path: { sessionId: session.session_id } },
    });
    if (result.error) {
      setMessage(messageFrom(result.error, "Assessment could not start"));
      return;
    }
    setSelected({ ...session, status: "in_progress" });
    setMessage("Assessment started. Your work is saved only when you submit it.");
    await load();
  }

  async function submit() {
    if (!selected || !sourceText.trim()) return;
    const result = await api.POST("/v1/candidate/assessments/{sessionId}/submissions", {
      params: { path: { sessionId: selected.session_id } },
      body: { language, sourceText },
    });
    if (result.error) {
      setMessage(messageFrom(result.error, "Submission failed"));
      return;
    }
    setSourceText("");
    setSelected(undefined);
    setMessage("Submission received. Candidate code is never executed inside the core API; it requires the isolated assessment runner.");
    await load();
  }

  if (loading) return <div className="grid min-h-screen place-items-center text-sm text-slate-500">Loading assessments…</div>;

  return (
    <main className="mx-auto max-w-5xl p-5 sm:p-8">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-[.15em] text-indigo-600">Candidate assessment</div>
        <h1 className="mt-2 text-2xl font-semibold text-slate-950">Technical assessments</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          Complete only assessments assigned to this application. Integrity signals may be shown to reviewers as context and are never automatic findings of misconduct.
        </p>
        {message ? <div role="status" aria-live="polite" className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-xs text-indigo-800">{message}</div> : null}
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[.9fr_1.1fr]">
        <section className="space-y-3">
          {sessions.length ? sessions.map((session) => (
            <article key={session.session_id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div><h2 className="text-sm font-semibold text-slate-900">{session.title}</h2><p className="mt-1 text-xs text-slate-500">{session.job_title} · {session.assessment_type}</p></div>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-600">{session.status}</span>
              </div>
              <p className="mt-3 text-xs leading-5 text-slate-600">{session.instructions}</p>
              {session.time_limit_minutes ? <div className="mt-3 text-[11px] text-slate-500">Time limit: {session.time_limit_minutes} minutes</div> : null}
              {session.result_status ? <div className="mt-3 rounded-lg bg-slate-50 p-3 text-[11px] text-slate-600">Result: {session.result_status}{session.normalized_score != null ? ` · ${session.normalized_score}/100` : ""} · Review: {session.review_state || "pending"}</div> : null}
              {session.status === "invited" ? <button type="button" onClick={() => void start(session)} className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white">Start assessment</button> : null}
              {session.status === "in_progress" ? <button type="button" onClick={() => setSelected(session)} className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white">Continue</button> : null}
            </article>
          )) : <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">No assessments are assigned to this application.</div>}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold">Submission editor</h2>
          {selected ? <><div className="mt-3 text-xs text-slate-500">{selected.title}</div><label className="mt-4 block text-xs font-semibold text-slate-600">Language<select value={language} onChange={(event) => setLanguage(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-xs"><option value="typescript">TypeScript</option><option value="javascript">JavaScript</option><option value="python">Python</option><option value="csharp">C#</option><option value="java">Java</option><option value="text">Text / design answer</option></select></label><label className="mt-4 block text-xs font-semibold text-slate-600">Answer / source<textarea value={sourceText} onChange={(event) => setSourceText(event.target.value)} className="mt-1 min-h-[360px] w-full rounded-xl border border-slate-200 p-4 font-mono text-xs leading-5" spellCheck={false} /></label><button type="button" disabled={!sourceText.trim()} onClick={() => void submit()} className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">Submit final answer</button></> : <p className="mt-4 text-xs leading-5 text-slate-500">Start or continue an assessment to open the submission editor.</p>}
        </section>
      </div>
    </main>
  );
}

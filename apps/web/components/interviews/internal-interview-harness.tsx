"use client";

import { useMemo, useState } from "react";
import { Icon } from "../product/icon";

const apiUrl = "/api/backend";

const intents = [
  "ANSWER",
  "CLARIFICATION_REQUEST",
  "SKIP_REQUEST",
  "INTERRUPTION",
  "SILENCE_TIMEOUT",
  "RECONNECT",
  "CANDIDATE_QUESTION",
  "POLICY_REFUSAL",
] as const;

type CandidateIntent = (typeof intents)[number];

type DevelopmentContext = {
  ready: boolean;
  reason?: string;
  organizationId?: string;
  userId?: string;
  fixtures?: {
    applicationId: string;
    interviewPlanId: string;
    consentRecordId: string;
    criteria: Array<{ id: string; key: string; label: string }>;
  };
};

type BrainTurn = {
  id: string;
  sequence: number;
  questionId: string;
  action: string;
  criterion: string | null;
  objective: string;
  spokenText: string;
  expectedEvidence: string[];
  brainVersion: string;
  brainReason: string;
  remainingSeconds: number;
  evidenceCoverage: Record<string, number>;
  releaseMode: string;
};

type HarnessMessage = {
  id: string;
  speaker: "candidate" | "interviewer" | "system";
  text: string;
  meta?: string;
};

function authHeaders(context: DevelopmentContext): HeadersInit {
  if (!context.organizationId || !context.userId) throw new Error("Development API context is incomplete");
  return {
    "content-type": "application/json",
    "x-organization-id": context.organizationId,
    "x-user-id": context.userId,
  };
}

async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const message = Array.isArray(data.message)
      ? data.message.filter((item): item is string => typeof item === "string").join("; ")
      : typeof data.message === "string"
        ? data.message
        : `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return data as T;
}

function estimateSpeechDurationMs(text: string): number {
  return Math.min(90_000, Math.max(1_500, Math.round(text.trim().length * 55)));
}

export function InternalInterviewHarness() {
  const [context, setContext] = useState<DevelopmentContext | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [lastTurn, setLastTurn] = useState<BrainTurn | null>(null);
  const [messages, setMessages] = useState<HarnessMessage[]>([]);
  const [candidateText, setCandidateText] = useState("");
  const [intent, setIntent] = useState<CandidateIntent>("ANSWER");
  const [markEvidence, setMarkEvidence] = useState(true);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sessionClosed = lastTurn?.action === "close";
  const currentCriterion = useMemo(
    () => context?.fixtures?.criteria.find((criterion) => criterion.key === lastTurn?.criterion) ?? null,
    [context, lastTurn?.criterion],
  );

  async function appendTranscript(
    activeContext: DevelopmentContext,
    activeSessionId: string,
    speaker: "candidate" | "interviewer",
    text: string,
    startMs: number,
  ) {
    const durationMs = estimateSpeechDurationMs(text);
    const response = await fetch(`${apiUrl}/v1/interviews/${activeSessionId}/transcript-segments`, {
      method: "POST",
      headers: authHeaders(activeContext),
      body: JSON.stringify({
        speaker,
        startMs,
        endMs: startMs + durationMs,
        text,
        isFinal: true,
      }),
    });
    const result = await readJson<{ id: string }>(response);
    return { id: result.id, endMs: startMs + durationMs };
  }

  async function requestBrainTurn(
    activeContext: DevelopmentContext,
    activeSessionId: string,
    input: { latestCandidateText?: string; candidateIntent?: CandidateIntent; elapsedSeconds?: number },
  ) {
    const response = await fetch(`${apiUrl}/v1/interviews/${activeSessionId}/brain/next-turn`, {
      method: "POST",
      headers: authHeaders(activeContext),
      body: JSON.stringify(input),
    });
    return readJson<BrainTurn>(response);
  }

  async function startInternalSession() {
    setBusy(true);
    setError(null);
    try {
      const contextResponse = await fetch(`${apiUrl}/development/context`, { cache: "no-store" });
      const loadedContext = await readJson<DevelopmentContext>(contextResponse);
      if (!loadedContext.ready || !loadedContext.fixtures) {
        throw new Error(loadedContext.reason ?? "Development fixtures are not ready");
      }
      setContext(loadedContext);

      const sessionResponse = await fetch(`${apiUrl}/v1/interviews/sessions`, {
        method: "POST",
        headers: authHeaders(loadedContext),
        body: JSON.stringify({
          applicationId: loadedContext.fixtures.applicationId,
          interviewPlanId: loadedContext.fixtures.interviewPlanId,
          consentRecordId: loadedContext.fixtures.consentRecordId,
          candidateIsRealCustomerCandidate: false,
          synchronousHumanSupervisorPresent: false,
        }),
      });
      const session = await readJson<{ id: string; lifecycleStage: string; releaseMode: string }>(sessionResponse);

      await readJson(
        await fetch(`${apiUrl}/v1/interviews/${session.id}/state/transitions`, {
          method: "POST",
          headers: authHeaders(loadedContext),
          body: JSON.stringify({
            idempotencyKey: `internal-harness-start-${session.id}`,
            action: "start",
          }),
        }),
      );

      setSessionId(session.id);
      setElapsedMs(0);
      setMessages([
        {
          id: "session-start",
          speaker: "system",
          text: `Internal synthetic session started · ${session.lifecycleStage} · ${session.releaseMode}`,
        },
      ]);

      const firstTurn = await requestBrainTurn(loadedContext, session.id, { elapsedSeconds: 0 });
      const transcript = await appendTranscript(loadedContext, session.id, "interviewer", firstTurn.spokenText, 0);
      setElapsedMs(transcript.endMs);
      setLastTurn(firstTurn);
      setMessages((current) => [
        ...current,
        {
          id: firstTurn.id,
          speaker: "interviewer",
          text: firstTurn.spokenText,
          meta: `${firstTurn.action} · ${firstTurn.criterion ?? "session"} · ${firstTurn.brainVersion}`,
        },
      ]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start the internal interview session");
    } finally {
      setBusy(false);
    }
  }

  async function submitCandidateTurn() {
    if (!context || !sessionId || !lastTurn) return;
    const text = candidateText.trim();
    if (intent === "ANSWER" && !text) {
      setError("Enter a candidate answer or choose a non-answer intent.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const candidateDisplay = text || `[${intent}]`;
      const candidateTranscript = await appendTranscript(
        context,
        sessionId,
        "candidate",
        candidateDisplay,
        elapsedMs,
      );
      let nextElapsedMs = candidateTranscript.endMs;

      setMessages((current) => [
        ...current,
        {
          id: `candidate-${candidateTranscript.id}`,
          speaker: "candidate",
          text: candidateDisplay,
          meta: intent,
        },
      ]);

      if (intent === "ANSWER" && markEvidence && lastTurn.criterion) {
        const criterion = context.fixtures?.criteria.find((item) => item.key === lastTurn.criterion);
        if (criterion) {
          const evidenceResponse = await fetch(`${apiUrl}/v1/interviews/${sessionId}/evidence`, {
            method: "POST",
            headers: authHeaders(context),
            body: JSON.stringify({
              criterionId: criterion.id,
              turnId: lastTurn.id,
              transcriptSegmentIds: [candidateTranscript.id],
              summary: `Manual internal-harness evidence: ${text}`,
            }),
          });
          await readJson(evidenceResponse);
          setMessages((current) => [
            ...current,
            {
              id: `evidence-${candidateTranscript.id}`,
              speaker: "system",
              text: `Manual evidence recorded for ${criterion.label}.`,
            },
          ]);
        }
      }

      const durationSeconds = Math.max(0, Math.round((candidateTranscript.endMs - elapsedMs) / 1000));
      const nextTurn = await requestBrainTurn(context, sessionId, {
        latestCandidateText: text,
        candidateIntent: intent,
        elapsedSeconds: durationSeconds,
      });
      const interviewerTranscript = await appendTranscript(
        context,
        sessionId,
        "interviewer",
        nextTurn.spokenText,
        nextElapsedMs,
      );
      nextElapsedMs = interviewerTranscript.endMs;

      setElapsedMs(nextElapsedMs);
      setLastTurn(nextTurn);
      setCandidateText("");
      setIntent("ANSWER");
      setMessages((current) => [
        ...current,
        {
          id: nextTurn.id,
          speaker: "interviewer",
          text: nextTurn.spokenText,
          meta: `${nextTurn.action} · ${nextTurn.criterion ?? "session"} · ${nextTurn.brainReason}`,
        },
      ]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Candidate turn failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[.14em] text-indigo-600">M4 · internal engineering harness</div>
          <h1 className="mt-2 text-[26px] font-semibold tracking-tight text-slate-950">Controlled Interview Brain</h1>
          <p className="mt-1 max-w-3xl text-[11px] leading-5 text-slate-500">
            Real persisted session/turn/transcript/evidence flow using the deterministic state machine. Synthetic development candidate only; no realtime STT/TTS/avatar is represented as connected.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-[10px]">
          <span className="rounded-full bg-amber-50 px-3 py-1.5 font-semibold text-amber-700">DEV_ONLY</span>
          <span className="rounded-full bg-indigo-50 px-3 py-1.5 font-semibold text-indigo-700">deterministic-state-machine-v1</span>
        </div>
      </div>

      {!sessionId ? (
        <div className="rounded-[14px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <div className="text-[13px] font-semibold text-slate-900">Start a synthetic persisted interview session</div>
              <p className="mt-1 text-[10px] leading-5 text-slate-500">
                The API resolves your development organization/user and seeded interview plan, enforces DEV_ONLY release policy, then persists every controlled turn.
              </p>
            </div>
            <button
              type="button"
              onClick={startInternalSession}
              disabled={busy}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-[10px] bg-indigo-600 px-4 text-[11px] font-semibold text-white hover:bg-indigo-700 disabled:cursor-wait disabled:bg-slate-300"
            >
              <Icon name="play" size={14} />
              {busy ? "Starting…" : "Start internal session"}
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-[12px] border border-rose-100 bg-rose-50 p-4 text-[10px] leading-5 text-rose-700">{error}</div>
      ) : null}

      {sessionId ? (
        <div className="grid gap-4 xl:grid-cols-[1.35fr_.65fr]">
          <section className="overflow-hidden rounded-[14px] border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <div className="text-[12px] font-semibold">Interview transcript harness</div>
                <div className="mt-1 font-mono text-[9px] text-slate-400">session {sessionId}</div>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-[9px] font-semibold ${sessionClosed ? "bg-slate-100 text-slate-600" : "bg-emerald-50 text-emerald-700"}`}>
                {sessionClosed ? "Completed" : "In progress"}
              </span>
            </div>

            <div className="max-h-[520px] min-h-[360px] space-y-3 overflow-y-auto bg-slate-50/60 p-5">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`max-w-[88%] rounded-[12px] border p-3 ${
                    message.speaker === "candidate"
                      ? "ms-auto border-indigo-100 bg-indigo-50"
                      : message.speaker === "interviewer"
                        ? "border-slate-200 bg-white"
                        : "mx-auto border-amber-100 bg-amber-50"
                  }`}
                >
                  <div className="text-[9px] font-semibold uppercase tracking-[.1em] text-slate-400">{message.speaker}</div>
                  <div className="mt-1 text-[11px] leading-5 text-slate-700">{message.text}</div>
                  {message.meta ? <div className="mt-2 text-[9px] text-slate-400">{message.meta}</div> : null}
                </div>
              ))}
            </div>

            {!sessionClosed ? (
              <div className="space-y-3 border-t border-slate-100 p-5">
                <textarea
                  value={candidateText}
                  onChange={(event) => setCandidateText(event.target.value)}
                  rows={4}
                  placeholder="Type a synthetic candidate answer…"
                  className="w-full resize-y rounded-[11px] border border-slate-200 bg-white p-3 text-[11px] leading-5 outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50"
                />
                <div className="grid gap-3 md:grid-cols-[220px_1fr_auto] md:items-center">
                  <select
                    value={intent}
                    onChange={(event) => setIntent(event.target.value as CandidateIntent)}
                    className="h-10 rounded-[10px] border border-slate-200 bg-white px-3 text-[10px] text-slate-700 outline-none"
                  >
                    {intents.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                  <label className="flex items-center gap-2 text-[10px] text-slate-600">
                    <input
                      type="checkbox"
                      checked={markEvidence}
                      onChange={(event) => setMarkEvidence(event.target.checked)}
                      disabled={intent !== "ANSWER"}
                      className="h-4 w-4 accent-indigo-600"
                    />
                    Manual harness: record this answer as criterion evidence
                  </label>
                  <button
                    type="button"
                    onClick={submitCandidateTurn}
                    disabled={busy}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-[10px] bg-indigo-600 px-4 text-[11px] font-semibold text-white hover:bg-indigo-700 disabled:cursor-wait disabled:bg-slate-300"
                  >
                    {busy ? "Persisting…" : "Submit turn"}
                    <Icon name="arrow" size={14} />
                  </button>
                </div>
              </div>
            ) : null}
          </section>

          <aside className="space-y-3">
            <div className="rounded-[14px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-[12px] font-semibold">Brain state</div>
              <div className="mt-4 space-y-3 text-[10px]">
                <div className="flex justify-between gap-3"><span className="text-slate-400">Criterion</span><span className="font-semibold text-slate-700">{currentCriterion?.label ?? lastTurn?.criterion ?? "—"}</span></div>
                <div className="flex justify-between gap-3"><span className="text-slate-400">Action</span><span className="font-semibold text-slate-700">{lastTurn?.action ?? "—"}</span></div>
                <div className="flex justify-between gap-3"><span className="text-slate-400">Remaining</span><span className="font-semibold text-slate-700">{lastTurn ? `${Math.floor(lastTurn.remainingSeconds / 60)}m ${lastTurn.remainingSeconds % 60}s` : "—"}</span></div>
                <div className="flex justify-between gap-3"><span className="text-slate-400">Release mode</span><span className="font-semibold text-slate-700">{lastTurn?.releaseMode ?? "—"}</span></div>
              </div>
            </div>

            <div className="rounded-[14px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-[12px] font-semibold">Evidence coverage</div>
              <div className="mt-4 space-y-2">
                {context?.fixtures?.criteria.map((criterion) => (
                  <div key={criterion.id} className="flex items-center justify-between rounded-[9px] bg-slate-50 px-3 py-2 text-[10px]">
                    <span>{criterion.label}</span>
                    <span className="font-semibold text-indigo-700">{lastTurn?.evidenceCoverage[criterion.key] ?? 0}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[14px] border border-amber-100 bg-amber-50 p-4 text-[10px] leading-5 text-amber-800">
              This harness intentionally stops before realtime speech/media. Candidate video is not analyzed for personality, emotion, honesty, confidence or suitability.
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

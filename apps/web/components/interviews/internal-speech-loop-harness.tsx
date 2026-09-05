"use client";

import { useEffect, useState } from "react";

type DevelopmentContext = {
  ready: boolean;
  reason?: string;
  organizationId?: string;
  userId?: string;
  fixtures?: {
    applicationId: string;
    interviewPlanId: string;
    consentRecordId: string;
  };
};

const apiUrl = "/api/backend";

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

export function InternalSpeechLoopHarness() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Brain → persisted spoken_text → local TTS has not been exercised yet.");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [turnPreview, setTurnPreview] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  async function run() {
    setBusy(true);
    setMessage("Preparing synthetic Brain → TTS validation…");
    setTurnPreview(null);
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }
    try {
      const context = await readJson<DevelopmentContext>(
        await fetch(`${apiUrl}/development/context`, { cache: "no-store" }),
      );
      if (!context.ready || !context.fixtures) throw new Error(context.reason ?? "Development fixtures are not ready");

      const session = await readJson<{ id: string }>(
        await fetch(`${apiUrl}/v1/interviews/sessions`, {
          method: "POST",
          headers: authHeaders(context),
          body: JSON.stringify({
            applicationId: context.fixtures.applicationId,
            interviewPlanId: context.fixtures.interviewPlanId,
            consentRecordId: context.fixtures.consentRecordId,
            candidateIsRealCustomerCandidate: false,
            synchronousHumanSupervisorPresent: false,
          }),
        }),
      );

      await readJson(
        await fetch(`${apiUrl}/v1/interviews/${session.id}/state/transitions`, {
          method: "POST",
          headers: authHeaders(context),
          body: JSON.stringify({
            idempotencyKey: `speech-loop-start-${session.id}`,
            action: "start",
          }),
        }),
      );

      const turn = await readJson<{ id: string; spokenText: string }>(
        await fetch(`${apiUrl}/v1/interviews/${session.id}/brain/next-turn`, {
          method: "POST",
          headers: authHeaders(context),
          body: JSON.stringify({ elapsedSeconds: 0 }),
        }),
      );
      setTurnPreview(turn.spokenText);

      const mediaSession = await readJson<{ id: string }>(
        await fetch(`${apiUrl}/v1/interviews/${session.id}/media/sessions`, {
          method: "POST",
          headers: authHeaders(context),
          body: JSON.stringify({ mode: "audio" }),
        }),
      );

      const audioResponse = await fetch(
        `${apiUrl}/v1/interviews/${session.id}/media/sessions/${mediaSession.id}/turns/${turn.id}/audio`,
        {
          method: "POST",
          headers: authHeaders(context),
        },
      );
      if (!audioResponse.ok) {
        const detail = await audioResponse.text();
        throw new Error(`TTS bridge failed (${audioResponse.status}): ${detail.slice(0, 500)}`);
      }
      const blob = await audioResponse.blob();
      if (!blob.type.startsWith("audio/")) throw new Error(`Unexpected TTS response type: ${blob.type || "missing"}`);
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
      setMessage("Persisted finalized Brain spoken_text was synthesized by the local worker. No client-supplied interview text was accepted by the TTS endpoint.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Brain → TTS validation failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-[14px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-[10px] font-semibold uppercase tracking-[.12em] text-indigo-600">M4 · speech loop validation</div>
      <div className="mt-1 text-[13px] font-semibold text-slate-900">Persisted Brain turn → local TTS</div>
      <p className="mt-1 max-w-3xl text-[10px] leading-5 text-slate-500">This path loads `spoken_text` from a finalized persisted Interview Brain turn on the server. The browser never posts arbitrary interview text to TTS.</p>
      <div className="mt-4 rounded-[10px] bg-slate-50 p-3 text-[10px] leading-5 text-slate-600">{message}</div>
      {turnPreview ? <div className="mt-3 rounded-[10px] border border-slate-100 p-3 text-[10px] leading-5 text-slate-600"><span className="font-semibold text-slate-800">Persisted spoken text:</span> {turnPreview}</div> : null}
      {audioUrl ? <audio className="mt-3 w-full" controls src={audioUrl} /> : null}
      <button type="button" disabled={busy} onClick={run} className="mt-4 h-9 rounded-[9px] bg-indigo-600 px-4 text-[10px] font-semibold text-white disabled:bg-slate-300">{busy ? "Running…" : "Run Brain → TTS check"}</button>
    </section>
  );
}

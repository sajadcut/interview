"use client";

import { useState } from "react";
import { InternalLiveKitTransport } from "./internal-livekit-transport";

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

export function InternalLiveKitSessionHarness() {
  const [context, setContext] = useState<DevelopmentContext | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function prepare() {
    setBusy(true);
    setError(null);
    try {
      const loaded = await readJson<DevelopmentContext>(
        await fetch(`${apiUrl}/development/context`, { cache: "no-store" }),
      );
      if (!loaded.ready || !loaded.fixtures || !loaded.organizationId || !loaded.userId) {
        throw new Error(loaded.reason ?? "Development fixtures are not ready");
      }
      const session = await readJson<{ id: string }>(
        await fetch(`${apiUrl}/v1/interviews/sessions`, {
          method: "POST",
          headers: authHeaders(loaded),
          body: JSON.stringify({
            applicationId: loaded.fixtures.applicationId,
            interviewPlanId: loaded.fixtures.interviewPlanId,
            consentRecordId: loaded.fixtures.consentRecordId,
            candidateIsRealCustomerCandidate: false,
            synchronousHumanSupervisorPresent: false,
          }),
        }),
      );
      setContext(loaded);
      setSessionId(session.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not prepare LiveKit transport session");
    } finally {
      setBusy(false);
    }
  }

  if (context?.organizationId && context.userId && sessionId) {
    return (
      <InternalLiveKitTransport
        sessionId={sessionId}
        organizationId={context.organizationId}
        userId={context.userId}
      />
    );
  }

  return (
    <section className="rounded-[14px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-[10px] font-semibold uppercase tracking-[.12em] text-indigo-600">M4 · transport runtime</div>
      <div className="mt-1 text-[13px] font-semibold text-slate-900">Prepare synthetic LiveKit transport session</div>
      <p className="mt-1 max-w-3xl text-[10px] leading-5 text-slate-500">Creates a separate synthetic interview session for WebRTC transport validation. It never issues credentials for a real customer candidate.</p>
      {error ? <div className="mt-3 rounded-[10px] border border-rose-100 bg-rose-50 p-3 text-[10px] text-rose-700">{error}</div> : null}
      <button type="button" onClick={prepare} disabled={busy} className="mt-4 h-9 rounded-[9px] bg-indigo-600 px-4 text-[10px] font-semibold text-white disabled:bg-slate-300">{busy ? "Preparing…" : "Prepare transport session"}</button>
    </section>
  );
}

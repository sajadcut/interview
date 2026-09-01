"use client";

import { useCallback, useEffect, useState } from "react";
import { api, apiErrorMessage } from "../../lib/api";
import { resolveTenantIdentity, tenantHeaders } from "../../lib/tenant-client";

type RealtimeMediaMode = "audio" | "avatar";

type ProviderStatus = {
  component: "transport" | "vad" | "stt" | "tts" | "avatar";
  provider: string;
  configured: boolean;
  reachable: boolean;
  ready: boolean;
  version?: string;
  reason?: string;
  checkedAt?: string;
};

type MediaReadiness = {
  enabled: boolean;
  mode: RealtimeMediaMode;
  ready: boolean;
  blockers: string[];
  providers: ProviderStatus[];
  requiredComponents: ProviderStatus["component"][];
  privacy: {
    candidateVideoAnalysis: "none";
    biometricInferenceAllowed: false;
    rawMediaPersistedByApi: false;
    spokenTextOnlyToAvatar: true;
  };
};

function statusLabel(provider: ProviderStatus): string {
  if (provider.ready) return "Ready";
  if (provider.reachable) return "Reachable · not ready";
  if (provider.configured) return "Configured · unreachable";
  return "Not configured";
}

function statusClass(provider: ProviderStatus): string {
  if (provider.ready) return "bg-emerald-50 text-emerald-700 ring-emerald-100";
  if (provider.configured) return "bg-amber-50 text-amber-700 ring-amber-100";
  return "bg-slate-100 text-slate-500 ring-slate-200";
}

const componentLabels: Record<ProviderStatus["component"], string> = {
  transport: "Transport",
  vad: "Voice activity detection",
  stt: "Speech to text",
  tts: "Text to speech",
  avatar: "Avatar",
};

export function InternalMediaReadinessPanel() {
  const [mode, setMode] = useState<RealtimeMediaMode>("audio");
  const [readiness, setReadiness] = useState<MediaReadiness | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadReadiness = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const identity = await resolveTenantIdentity();
      const result = await api.GET("/v1/interviews/media/readiness", {
        headers: tenantHeaders(identity),
        params: { query: { mode } },
      });
      if (!result.response.ok) {
        throw new Error(apiErrorMessage(result, "Could not load realtime media readiness"));
      }
      setReadiness(result.data as MediaReadiness);
    } catch (cause) {
      setReadiness(null);
      setError(cause instanceof Error ? cause.message : "Could not load realtime media readiness");
    } finally {
      setBusy(false);
    }
  }, [mode]);

  useEffect(() => {
    void loadReadiness();
  }, [loadReadiness]);

  return (
    <section className="rounded-[14px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[.14em] text-indigo-600">M4 · realtime readiness boundary</div>
          <h2 className="mt-1 text-[18px] font-semibold tracking-tight text-slate-950">Self-hosted media pipeline readiness</h2>
          <p className="mt-1 max-w-3xl text-[10px] leading-5 text-slate-500">
            Provider health is checked through the typed API contract. Configuration alone never marks transport, VAD, STT, TTS or avatar as connected.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(["audio", "avatar"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setMode(item)}
              aria-pressed={mode === item}
              className={`rounded-full px-3 py-1.5 text-[9px] font-semibold ring-1 ${
                mode === item
                  ? "bg-indigo-600 text-white ring-indigo-600"
                  : "bg-white text-slate-500 ring-slate-200 hover:bg-slate-50"
              }`}
            >
              {item === "audio" ? "Audio mode" : "Avatar mode"}
            </button>
          ))}
          <button
            type="button"
            onClick={() => void loadReadiness()}
            disabled={busy}
            className="rounded-full bg-slate-100 px-3 py-1.5 text-[9px] font-semibold text-slate-600 hover:bg-slate-200 disabled:cursor-wait disabled:opacity-60"
          >
            {busy ? "Checking…" : "Refresh health"}
          </button>
        </div>
      </div>

      {error ? (
        <div role="alert" className="mt-4 rounded-[10px] border border-rose-100 bg-rose-50 px-3 py-2 text-[10px] leading-5 text-rose-700">{error}</div>
      ) : null}

      {readiness ? (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-3 py-1.5 text-[9px] font-semibold ring-1 ${
              readiness.ready
                ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
                : "bg-amber-50 text-amber-700 ring-amber-100"
            }`}>
              {readiness.ready ? "Pipeline ready" : "Launch blocked"}
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1.5 text-[9px] font-semibold text-slate-600">
              realtime {readiness.enabled ? "enabled" : "disabled"}
            </span>
            <span className="text-[9px] text-slate-400">Mode: {readiness.mode}</span>
          </div>

          <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
            {readiness.providers.map((provider) => {
              const required = readiness.requiredComponents.includes(provider.component);
              return (
                <div key={provider.component} className="rounded-[11px] border border-slate-100 bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-[10px] font-semibold text-slate-800">{componentLabels[provider.component]}</div>
                      <div className="mt-1 font-mono text-[8px] text-slate-400">{provider.provider || "disabled"}</div>
                    </div>
                    <span className="text-[8px] font-medium text-slate-400">{required ? "required" : "optional"}</span>
                  </div>
                  <div className={`mt-3 inline-flex rounded-full px-2 py-1 text-[8px] font-semibold ring-1 ${statusClass(provider)}`}>
                    {statusLabel(provider)}
                  </div>
                  {provider.version ? <div className="mt-2 text-[8px] text-slate-400">Version {provider.version}</div> : null}
                  {provider.reason ? <div className="mt-2 text-[8px] leading-4 text-slate-500">{provider.reason}</div> : null}
                </div>
              );
            })}
          </div>

          {readiness.blockers.length > 0 ? (
            <div className="mt-4 rounded-[11px] border border-amber-100 bg-amber-50 p-4">
              <div className="text-[10px] font-semibold text-amber-800">Launch blockers</div>
              <ul className="mt-2 space-y-1 text-[9px] leading-4 text-amber-800">
                {readiness.blockers.map((blocker) => <li key={blocker}>• {blocker}</li>)}
              </ul>
            </div>
          ) : null}

          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-[10px] border border-slate-100 p-3 text-[9px]"><div className="font-semibold text-slate-700">Candidate video analysis</div><div className="mt-1 text-slate-500">None</div></div>
            <div className="rounded-[10px] border border-slate-100 p-3 text-[9px]"><div className="font-semibold text-slate-700">Biometric inference</div><div className="mt-1 text-slate-500">Not allowed</div></div>
            <div className="rounded-[10px] border border-slate-100 p-3 text-[9px]"><div className="font-semibold text-slate-700">Raw media in API DB</div><div className="mt-1 text-slate-500">Not persisted</div></div>
            <div className="rounded-[10px] border border-slate-100 p-3 text-[9px]"><div className="font-semibold text-slate-700">Avatar input</div><div className="mt-1 text-slate-500">Final spoken text only</div></div>
          </div>
        </>
      ) : busy ? <div role="status" className="mt-4 rounded-[10px] bg-slate-50 p-4 text-[10px] text-slate-500">Checking provider readiness…</div> : null}
    </section>
  );
}

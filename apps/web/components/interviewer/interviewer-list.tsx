"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { resolveTenantIdentity, tenantHeaders } from "../../lib/tenant-client";

type AssignedInterview = {
  assignmentId: string;
  assignmentStatus: string;
  scheduledFor?: string;
  sessionId: string;
  sessionStatus: string;
  candidateName: string;
  jobTitle: string;
};

export function InterviewerList({ title = "My interviews" }: { title?: string }) {
  const [items, setItems] = useState<AssignedInterview[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    resolveTenantIdentity()
      .then(async (identity) => {
        const response = await fetch("/api/backend/v1/interviewer/interviews", {
          credentials: "same-origin",
          cache: "no-store",
          headers: tenantHeaders(identity),
        });
        if (response.status === 401) {
          window.location.replace("/login");
          return;
        }
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          const message = payload && typeof payload === "object" && "message" in payload
            ? String((payload as { message?: unknown }).message)
            : "Unable to load assigned interviews";
          throw new Error(message);
        }
        setItems(payload as AssignedInterview[]);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load assigned interviews"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[.14em] text-indigo-600">Assigned work</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-[-.03em] text-slate-950">{title}</h1>
          <p className="mt-1 text-xs text-slate-500">Only interviews assigned to your user account are available in this workspace.</p>
        </div>
      </div>

      {error ? <div className="mt-4 rounded-xl border border-red-100 bg-red-50 p-3 text-xs text-red-700">{error}</div> : null}
      <div className="mt-5 grid gap-3">
        {items.map((item) => (
          <Link key={item.assignmentId} href={`/interviewer/session/${item.sessionId}`} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-indigo-200">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">{item.candidateName}</div>
                <div className="mt-1 text-xs text-slate-500">{item.jobTitle}</div>
              </div>
              <div className="text-right text-[10px] text-slate-500">
                <div className="font-semibold uppercase tracking-[.06em] text-indigo-600">{item.sessionStatus.replaceAll("_", " ")}</div>
                <div className="mt-1">{item.scheduledFor ? new Date(item.scheduledFor).toLocaleString() : "Schedule not set"}</div>
              </div>
            </div>
          </Link>
        ))}
        {!loading && items.length === 0 && !error ? <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-400">No interviews are currently assigned to you.</div> : null}
        {loading ? <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">Loading assignments…</div> : null}
      </div>
    </section>
  );
}

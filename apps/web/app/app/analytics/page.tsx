"use client";

import type { components } from "@interview/api-client";
import { useEffect, useState } from "react";
import { MetricCard, Panel, Pill, SectionHeader } from "../../../components/product/recruiting-ui";
import { api } from "../../../lib/api";
import { resolveTenantIdentity, tenantHeaders } from "../../../lib/tenant-client";

type AnalyticsSummary = components["schemas"]["AnalyticsSummaryDto"];

export default function AnalyticsPage() {
  const [summary, setSummary] = useState<AnalyticsSummary>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const identity = await resolveTenantIdentity();
        const result = await api.GET("/v1/analytics/summary", { headers: tenantHeaders(identity) });
        if (result.error || !result.data) throw new Error("Recruiting analytics could not be loaded");
        if (active) setSummary(result.data);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Recruiting analytics could not be loaded");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (loading) return <div className="py-16 text-center text-sm text-slate-500">Loading persisted recruiting analytics…</div>;
  if (!summary) return <div className="rounded-xl border border-rose-100 bg-rose-50 p-5 text-sm text-rose-700">{error || "Analytics are unavailable."}</div>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[24px] font-semibold tracking-[-.03em] text-slate-950">Recruiting analytics</h1>
        <p className="mt-1 text-[11px] text-slate-500">Live organization data for funnel, source performance, review load and governance context.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon="candidates" label="Applications" value={String(summary.funnel.totalApplications)} note="Persisted applications in this organization" />
        <MetricCard icon="interviews" label="Completed interviews" value={String(summary.funnel.completedInterviews)} note="Evidence review remains human-controlled" tone="violet" />
        <MetricCard icon="shield" label="Pending human reviews" value={String(summary.funnel.pendingHumanReviews)} note="Screening + scorecard review queue" tone="emerald" />
        <MetricCard icon="target" label="Tracked sources" value={String(summary.sources.length)} note="Operational source attribution" tone="amber" />
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.15fr_.85fr]">
        <Panel>
          <SectionHeader title="Hiring funnel" subtitle="Stage distribution; conversion is operational context, not a candidate score." />
          <div className="space-y-3 p-5 pt-4">
            {summary.funnel.stages.length ? summary.funnel.stages.map((stage) => (
              <div key={stage.stage} className="grid grid-cols-[120px_1fr_72px] items-center gap-3 text-[11px]">
                <span className="truncate font-medium text-slate-700">{stage.stage}</span>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.max(2, Math.min(100, stage.shareOfApplications))}%` }} />
                </div>
                <div className="text-right"><span className="font-semibold text-slate-900">{stage.count}</span><span className="ml-1 text-slate-400">{stage.shareOfApplications}%</span></div>
              </div>
            )) : <div className="py-8 text-center text-[11px] text-slate-400">No application-stage data is available yet.</div>}
          </div>
        </Panel>

        <Panel>
          <SectionHeader title="Governance boundary" subtitle="What these metrics may and may not be used for." />
          <div className="space-y-3 p-5 pt-4 text-[10px] leading-5 text-slate-600">
            <div className="rounded-[10px] border border-indigo-100 bg-indigo-50/60 p-3 text-indigo-900">{summary.governanceNotice}</div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-[10px] border border-slate-100 p-3"><div className="text-slate-400">Human review queue</div><div className="mt-1 text-lg font-semibold text-slate-900">{summary.funnel.pendingHumanReviews}</div></div>
              <div className="rounded-[10px] border border-slate-100 p-3"><div className="text-slate-400">Completed interviews</div><div className="mt-1 text-lg font-semibold text-slate-900">{summary.funnel.completedInterviews}</div></div>
            </div>
          </div>
        </Panel>
      </div>

      <Panel>
        <SectionHeader title="Source performance" subtitle="Pre-interview match context is kept separate from evidence-backed scorecards." />
        <div className="overflow-x-auto p-5 pt-4">
          <table className="w-full min-w-[720px] text-left text-[11px]">
            <thead className="border-b border-slate-100 text-[10px] font-semibold uppercase tracking-[.05em] text-slate-400">
              <tr><th className="pb-3">Source</th><th className="pb-3">Candidates</th><th className="pb-3">Avg pre-interview match</th><th className="pb-3">Reached interview</th><th className="pb-3">Signal type</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {summary.sources.length ? summary.sources.map((source) => (
                <tr key={source.source}>
                  <td className="py-3.5 font-semibold text-slate-800">{source.source}</td>
                  <td className="py-3.5 text-slate-600">{source.candidates}</td>
                  <td className="py-3.5 text-slate-600">{source.averagePreInterviewMatchScore === undefined ? "—" : `${source.averagePreInterviewMatchScore}%`}</td>
                  <td className="py-3.5 text-slate-600">{source.interviewStageOrLater}</td>
                  <td className="py-3.5"><Pill tone="blue">Operational / retrieval</Pill></td>
                </tr>
              )) : <tr><td colSpan={5} className="py-10 text-center text-slate-400">No source-attribution data is available yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

"use client";

import type { components } from "@interview/api-client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "../../components/product/icon";
import { MetricCard, Panel, Pill, SectionHeader } from "../../components/product/recruiting-ui";
import { api } from "../../lib/api";
import { resolveTenantIdentity, tenantHeaders } from "../../lib/tenant-client";

type JobSummary = components["schemas"]["JobSummaryDto"];
type CandidateSummary = components["schemas"]["CandidateSummaryDto"];
type AnalyticsSummary = components["schemas"]["AnalyticsSummaryDto"];

type AttentionItem = { title: string; detail: string; href: string; icon: "jobs" | "candidates" | "interviews" | "shield" };

export default function CommandCenterPage() {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [candidates, setCandidates] = useState<CandidateSummary[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsSummary>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const identity = await resolveTenantIdentity();
        const headers = tenantHeaders(identity);
        const [jobsResult, candidatesResult, analyticsResult] = await Promise.all([
          api.GET("/v1/jobs", { headers }),
          api.GET("/v1/candidates", { headers }),
          api.GET("/v1/analytics/summary", { headers }),
        ]);
        if (jobsResult.error || !jobsResult.data) throw new Error("Job metrics could not be loaded");
        if (candidatesResult.error || !candidatesResult.data) throw new Error("Candidate metrics could not be loaded");
        if (analyticsResult.error || !analyticsResult.data) throw new Error("Analytics could not be loaded");
        if (active) {
          setJobs(jobsResult.data);
          setCandidates(candidatesResult.data);
          setAnalytics(analyticsResult.data);
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Command center could not be loaded");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const openJobs = jobs.filter((job) => job.status.toLowerCase() === "open");
  const attention = useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = [];
    if ((analytics?.funnel.pendingHumanReviews ?? 0) > 0) {
      items.push({ title: `${analytics?.funnel.pendingHumanReviews} human reviews pending`, detail: "Screening and scorecard review queue", href: "/app/analytics", icon: "shield" });
    }
    for (const job of jobs.filter((item) => item.status.toLowerCase() === "open" && item.applicationCount === 0).slice(0, 2)) {
      items.push({ title: `${job.title} has no applications`, detail: "Review sourcing coverage or publish state", href: `/app/jobs/${job.id}`, icon: "jobs" });
    }
    for (const job of jobs.filter((item) => item.applicationCount > 0 && item.interviewCount === 0).slice(0, 2)) {
      items.push({ title: `${job.title} has not reached interview`, detail: `${job.applicationCount} persisted applications currently in the funnel`, href: `/app/jobs/${job.id}`, icon: "interviews" });
    }
    return items.slice(0, 5);
  }, [analytics, jobs]);

  if (loading) return <div className="py-16 text-center text-sm text-slate-500">Loading hiring command center…</div>;
  if (!analytics) return <div className="rounded-xl border border-rose-100 bg-rose-50 p-5 text-sm text-rose-700">{error || "Command center data is unavailable."}</div>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1 text-[11px] font-medium text-indigo-600">Command Center</div>
          <h1 className="text-[28px] font-semibold tracking-[-.03em] text-slate-950">Hiring command center</h1>
          <p className="mt-1.5 text-[12px] text-slate-500">Persisted organization data, human-review workload and funnel health.</p>
        </div>
        <span className="rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-[10px] font-semibold text-emerald-700">Live database data</span>
      </div>

      {error ? <div className="rounded-xl border border-amber-100 bg-amber-50 p-3 text-[10px] text-amber-800">{error}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon="jobs" label="Open Jobs" value={String(openJobs.length)} note={`${jobs.length} total persisted workspaces`} />
        <MetricCard icon="candidates" label="Candidates" value={String(candidates.length)} note={`${analytics.funnel.totalApplications} active/historical applications`} tone="violet" />
        <MetricCard icon="interviews" label="Completed Interviews" value={String(analytics.funnel.completedInterviews)} note="Persisted completed sessions" tone="indigo" />
        <MetricCard icon="shield" label="Pending Reviews" value={String(analytics.funnel.pendingHumanReviews)} note="Human-controlled review queue" tone="amber" />
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.05fr_.95fr]">
        <Panel>
          <SectionHeader title="Needs your attention" subtitle="Derived from persisted operational state; no invented customer metrics." action={<Link href="/app/analytics" className="text-[10px] font-semibold text-indigo-600">Analytics →</Link>} />
          <div className="space-y-1 px-5 pb-5 pt-3">
            {attention.length ? attention.map((item) => (
              <Link key={`${item.title}-${item.href}`} href={item.href} className="flex items-start gap-3 rounded-[10px] px-2 py-2.5 transition hover:bg-slate-50">
                <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-[8px] bg-indigo-50 text-indigo-600"><Icon name={item.icon} size={13} /></div>
                <div className="min-w-0"><div className="text-[11px] font-medium text-slate-800">{item.title}</div><div className="mt-1 text-[10px] text-slate-400">{item.detail}</div></div>
              </Link>
            )) : <div className="px-2 py-8 text-center text-[10px] text-slate-400">No review backlog or obvious funnel stall is present in the current persisted data.</div>}
          </div>
        </Panel>

        <Panel>
          <SectionHeader title="Recent job workspaces" subtitle="Most recently updated persisted hiring contexts." action={<Link href="/app/jobs" className="text-[10px] font-semibold text-indigo-600">View jobs →</Link>} />
          <div className="space-y-2 p-5 pt-3">
            {jobs.slice(0, 5).map((job) => (
              <Link key={job.id} href={`/app/jobs/${job.id}`} className="flex items-center justify-between gap-3 rounded-[10px] border border-slate-100 px-3 py-3 hover:border-indigo-100 hover:bg-indigo-50/20">
                <div className="min-w-0"><div className="truncate text-[11px] font-semibold text-slate-800">{job.title}</div><div className="mt-1 text-[9px] text-slate-400">{job.applicationCount} applications · {job.interviewCount} interviews</div></div>
                <Pill tone={job.status.toLowerCase() === "open" ? "green" : "slate"}>{job.status}</Pill>
              </Link>
            ))}
            {jobs.length === 0 ? <div className="py-8 text-center text-[10px] text-slate-400">No job workspaces exist yet.</div> : null}
          </div>
        </Panel>
      </div>

      <Panel>
        <SectionHeader title="Hiring pipeline overview" subtitle="Persisted application distribution; operational context only." action={<Link href="/app/analytics" className="text-[10px] text-indigo-600">Full analytics →</Link>} />
        <div className="grid gap-2.5 p-5 pt-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {analytics.funnel.stages.length ? analytics.funnel.stages.slice(0, 6).map((stage) => (
            <div key={stage.stage} className="relative rounded-[11px] border border-slate-100 p-3.5">
              <div className="truncate text-[10px] font-medium capitalize text-slate-400">{stage.stage.replaceAll("_", " ")}</div>
              <div className="mt-1.5 text-[20px] font-semibold tracking-tight text-slate-900">{stage.count}</div>
              <div className="mt-1 text-[9px] text-slate-400">{stage.shareOfApplications}% of applications</div>
              <div className="mt-3 h-1.5 rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500" style={{ width: `${Math.max(2, Math.min(100, stage.shareOfApplications))}%` }} /></div>
            </div>
          )) : <div className="col-span-full py-8 text-center text-[10px] text-slate-400">No application-stage data is available yet.</div>}
        </div>
      </Panel>

      <Panel>
        <SectionHeader title="Source context" subtitle={analytics.governanceNotice} />
        <div className="grid gap-2.5 p-5 pt-3 sm:grid-cols-2 xl:grid-cols-4">
          {analytics.sources.slice(0, 4).map((source) => (
            <div key={source.source} className="rounded-[11px] border border-slate-100 p-3.5">
              <div className="text-[10px] font-semibold text-slate-800">{source.source}</div>
              <div className="mt-2 text-[18px] font-semibold text-slate-900">{source.candidates}</div>
              <div className="mt-1 text-[9px] text-slate-400">candidates · {source.interviewStageOrLater} reached interview</div>
            </div>
          ))}
          {analytics.sources.length === 0 ? <div className="col-span-full py-8 text-center text-[10px] text-slate-400">No source-attribution data is available yet.</div> : null}
        </div>
      </Panel>
    </div>
  );
}

import { DemoNotice, MetricCard, Panel, Pill, ScoreBar, SectionHeader } from "../../../components/product/recruiting-ui";

const funnel = [
  ["Sourced", 523, 100],
  ["Screening", 132, 25.2],
  ["Interview", 34, 6.5],
  ["Finalist", 12, 2.3],
  ["Offered", 3, 0.6],
  ["Hired", 1, 0.2],
] as const;

const sources = [
  ["Internal Talent Pool", 42, 89, 16],
  ["AI Search", 37, 86, 11],
  ["Approved Job Board", 31, 81, 7],
  ["Referral", 18, 84, 6],
] as const;

export default function AnalyticsPage() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-semibold tracking-[-.03em] text-slate-950">Recruiting analytics</h1>
          <p className="mt-1 text-[11px] text-slate-500">Funnel, source quality, review load and AI governance signals.</p>
        </div>
        <DemoNotice />
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon="candidates" label="Active applications" value="523" note="Development fixture" />
        <MetricCard icon="interviews" label="Completed interviews" value="34" note="Evidence review remains human-controlled" tone="violet" />
        <MetricCard icon="clock" label="Median stage time" value="2.8d" note="Development fixture" tone="amber" />
        <MetricCard icon="shield" label="Pending human reviews" value="11" note="Screening + scorecard review queue" tone="emerald" />
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.15fr_.85fr]">
        <Panel>
          <SectionHeader title="Hiring funnel" subtitle="Stage distribution; conversion is operational context, not a candidate score." />
          <div className="space-y-3 p-5 pt-4">
            {funnel.map(([stage, count, share]) => (
              <div key={stage} className="grid grid-cols-[95px_1fr_60px] items-center gap-3 text-[11px]">
                <span className="font-medium text-slate-700">{stage}</span>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.max(2, share)}%` }} />
                </div>
                <div className="text-right"><span className="font-semibold text-slate-900">{count}</span><span className="ml-1 text-slate-400">{share}%</span></div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel>
          <SectionHeader title="AI governance" subtitle="Signals that determine where human review and calibration effort is needed." />
          <div className="space-y-4 p-5 pt-4">
            <ScoreBar label="Evidence coverage" value={91} />
            <ScoreBar label="Human review completion" value={82} tone="indigo" />
            <ScoreBar label="Interview policy coverage" value={76} tone="amber" />
            <div className="rounded-[10px] border border-amber-100 bg-amber-50/60 p-3 text-[10px] leading-5 text-amber-900">
              Autonomous interview release remains gated per release unit. Development metrics never constitute production approval.
            </div>
          </div>
        </Panel>
      </div>

      <Panel>
        <SectionHeader title="Source performance" subtitle="Pre-interview match is kept separate from evidence-backed scorecards." />
        <div className="overflow-x-auto p-5 pt-4">
          <table className="w-full min-w-[720px] text-left text-[11px]">
            <thead className="border-b border-slate-100 text-[10px] font-semibold uppercase tracking-[.05em] text-slate-400">
              <tr><th className="pb-3">Source</th><th className="pb-3">Candidates</th><th className="pb-3">Avg retrieval/match context</th><th className="pb-3">Reached interview</th><th className="pb-3">Policy</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sources.map(([source, candidates, match, interviewed]) => (
                <tr key={source}>
                  <td className="py-3.5 font-semibold text-slate-800">{source}</td>
                  <td className="py-3.5 text-slate-600">{candidates}</td>
                  <td className="py-3.5 text-slate-600">{match}% <span className="text-slate-400">pre-interview</span></td>
                  <td className="py-3.5 text-slate-600">{interviewed}</td>
                  <td className="py-3.5"><Pill tone="green">Approved source</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

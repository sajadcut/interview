import Link from "next/link";
import { aiActivity, attentionItems, recommendedActions } from "../../lib/demo-data";
import { Icon } from "../../components/product/icon";
import {
  DemoNotice,
  MetricCard,
  Panel,
  SectionHeader,
  TinyTrend,
} from "../../components/product/recruiting-ui";

export default function CommandCenterPage() {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1 text-[11px] font-medium text-indigo-600">Command Center</div>
          <h1 className="text-[28px] font-semibold tracking-[-.03em] text-slate-950">Good morning, Sara 👋</h1>
          <p className="mt-1.5 text-[12px] text-slate-500">Here’s what’s happening with your hiring today.</p>
        </div>
        <DemoNotice />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon="jobs" label="Open Jobs" value="24" note="6 open · 3 on hold" />
        <MetricCard icon="candidates" label="Active Candidates" value="342" note="+18 this week" tone="violet" />
        <MetricCard icon="interviews" label="Interviews Today" value="15" note="5 scheduled today" tone="indigo" />
        <MetricCard icon="briefcase" label="Offers" value="3" note="2 pending approval" tone="amber" />
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.08fr_1fr_.92fr]">
        <Panel>
          <SectionHeader
            title="Needs your attention"
            subtitle="Human decisions and stalled hiring work"
            action={
              <Link href="/app/candidates" className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-700">
                View all (12)
              </Link>
            }
          />
          <div className="space-y-1 px-5 pb-5 pt-3">
            {attentionItems.map(([title, sub, tone], index) => (
              <div key={title} className="flex items-start gap-3 rounded-[10px] px-2 py-2.5 transition hover:bg-slate-50">
                <div
                  className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-[8px] ${
                    tone === "violet"
                      ? "bg-violet-50 text-violet-600"
                      : tone === "blue"
                        ? "bg-blue-50 text-blue-600"
                        : tone === "green"
                          ? "bg-emerald-50 text-emerald-600"
                          : "bg-amber-50 text-amber-600"
                  }`}
                >
                  <Icon name={index === 0 ? "candidates" : index === 1 ? "interviews" : index === 2 ? "inbox" : "target"} size={13} />
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-medium text-slate-800">{title}</div>
                  <div className="mt-1 text-[10px] text-slate-400">{sub}</div>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel>
          <SectionHeader
            title="AI Recruiter activity"
            subtitle="Automated work with visible outcomes"
            action={<span className="text-[10px] text-slate-400">This week⌄</span>}
          />
          <div className="space-y-1 px-5 pb-4 pt-3">
            {aiActivity.map(([title, note], index) => (
              <div key={title} className="flex items-center gap-3 rounded-[10px] px-2 py-2.5">
                <div className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] bg-indigo-50 text-indigo-600">
                  <Icon name={index === 0 ? "candidates" : index === 1 ? "brain" : index === 2 ? "message" : "interviews"} size={13} />
                </div>
                <span className="min-w-0 flex-1 text-[11px] text-slate-700">{title}</span>
                <span className="whitespace-nowrap text-[9px] font-semibold text-emerald-600">{note}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-slate-100 px-5 py-3 text-center text-[10px] font-semibold text-indigo-600">View full activity →</div>
        </Panel>

        <Panel>
          <SectionHeader title="Recommended actions" subtitle="AI suggestions · recruiter approval required" />
          <div className="space-y-2.5 px-5 pb-5 pt-3">
            {recommendedActions.map(([title, sub], index) => (
              <div key={title} className="rounded-[11px] border border-slate-100 bg-slate-50/45 p-3.5 transition hover:border-slate-200 hover:bg-white">
                <div className="flex gap-2.5">
                  <div className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] bg-indigo-50 text-indigo-600">
                    <Icon name={index === 0 ? "candidates" : index === 1 ? "target" : "message"} size={13} />
                  </div>
                  <div>
                    <div className="text-[11px] font-medium text-slate-800">{title}</div>
                    <div className="mt-1 text-[10px] leading-4 text-slate-400">{sub}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel>
        <SectionHeader
          title="Upcoming"
          subtitle="Today and tomorrow"
          action={<span className="text-[10px] font-semibold text-indigo-600">View calendar</span>}
        />
        <div className="grid gap-2.5 p-5 pt-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["Interview", "Ali Rahimi", "Today, 11:00 AM"],
            ["Hiring Manager Review", "Senior Backend Engineer", "Today, 2:00 PM"],
            ["Interview", "Sara Mohammadi", "Tomorrow, 10:00 AM"],
            ["Job Approval", "DevOps Engineer", "Tomorrow, 3:00 PM"],
          ].map(([kind, name, time], index) => (
            <div key={name} className="flex gap-3 rounded-[11px] border border-slate-100 p-3.5">
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-violet-50 text-violet-600">
                <Icon name={index === 1 ? "jobs" : "calendar"} size={14} />
              </div>
              <div>
                <div className="text-[9px] font-medium uppercase tracking-wide text-slate-400">{kind}</div>
                <div className="mt-1 text-[11px] font-semibold text-slate-800">{name}</div>
                <div className="mt-1 text-[10px] text-slate-400">{time}</div>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel>
        <SectionHeader
          title="Hiring pipeline overview"
          subtitle="Conversion across the active funnel"
          action={<span className="text-[10px] text-slate-400">This month⌄</span>}
        />
        <div className="grid gap-2.5 p-5 pt-3 sm:grid-cols-3 xl:grid-cols-6">
          {[
            ["Applied", "523", "100%"],
            ["Screening", "132", "25%"],
            ["Interview", "34", "6.5%"],
            ["Finalist", "12", "2.3%"],
            ["Offered", "3", "0.6%"],
            ["Hired", "1", "0.2%"],
          ].map(([label, value, pct], index) => (
            <div key={label} className="relative rounded-[11px] border border-slate-100 p-3.5">
              <div className="text-[10px] font-medium text-slate-400">{label}</div>
              <div className="mt-1.5 flex items-end justify-between">
                <span className="text-[20px] font-semibold tracking-tight text-slate-900">{value}</span>
                <TinyTrend up={index !== 2} />
              </div>
              <div className="mt-1 text-[9px] text-slate-400">{pct} of applicants</div>
              <div className="mt-3 h-1.5 rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500"
                  style={{ width: `${Math.max(8, 100 - index * 17)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

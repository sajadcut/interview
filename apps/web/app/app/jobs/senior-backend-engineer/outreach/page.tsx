import { jobTabs } from "../../../../../lib/demo-data";
import { Icon } from "../../../../../components/product/icon";
import {
  Panel,
  Pill,
  SectionHeader,
  ToolbarButton,
  WorkspaceTabs,
} from "../../../../../components/product/recruiting-ui";

const messages = [
  { candidate: "Ali Rahimi", state: "Reply needs approval", note: "Asked about remote policy · grounded in Remote Policy v4", tone: "amber" as const },
  { candidate: "Sara Mohammadi", state: "Sequence active", note: "Follow-up scheduled tomorrow · no response in 4 days", tone: "blue" as const },
  { candidate: "Reza Akbari", state: "Candidate replied", note: "Asked about interview process · Process Guide v2", tone: "green" as const },
];

export default function JobOutreachPage() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 text-[10px] font-medium text-indigo-600">Senior Backend Engineer · Candidate engagement</div>
          <h1 className="text-[26px] font-semibold tracking-tight">Outreach, screening & scheduling</h1>
          <p className="mt-1 text-[12px] text-slate-500">
            Personalized candidate communication grounded in approved knowledge, deterministic hard minimums and recoverable scheduling state.
          </p>
        </div>
        <div className="flex gap-2"><ToolbarButton icon="columns">Templates</ToolbarButton><ToolbarButton primary icon="message">Create sequence</ToolbarButton></div>
      </div>

      <WorkspaceTabs tabs={jobTabs} active="Outreach" />

      <div className="grid gap-3 xl:grid-cols-[1.05fr_.95fr]">
        <Panel>
          <SectionHeader title="Candidate conversations" subtitle="AI drafts may be personalized, but job/company facts require approved knowledge references." action={<Pill tone="amber">3 approvals</Pill>} />
          <div className="space-y-2 p-5 pt-4">
            {messages.map((item, index) => (
              <div key={item.candidate} className="flex items-start gap-3 rounded-[11px] border border-slate-100 p-4">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-indigo-50 text-indigo-600"><Icon name={index === 1 ? "clock" : "message"} size={15} /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3"><div className="text-[12px] font-semibold">{item.candidate}</div><Pill tone={item.tone}>{item.state}</Pill></div>
                  <div className="mt-1 text-[10px] text-slate-500">{item.note}</div>
                  <div className="mt-3 flex gap-3 text-[10px] font-semibold text-indigo-600"><button>Open thread</button><button>View grounding</button></div>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel>
          <SectionHeader title="Approved knowledge" subtitle="Only approved and in-date content may ground factual candidate responses." />
          <div className="space-y-2 p-5 pt-4">
            {["Remote & hybrid policy · v4", "Benefits & insurance · v3", "Hiring process · v2", "Role salary range · v1"].map((item, index) => (
              <div key={item} className="flex items-center justify-between rounded-[10px] border border-slate-100 px-3.5 py-3">
                <div><div className="text-[11px] font-semibold">{item}</div><div className="mt-1 text-[9px] text-slate-400">Approved by HR Policy · {index + 1} month{index ? "s" : ""} ago</div></div>
                <Pill tone="green">Approved</Pill>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 xl:grid-cols-3">
        <Panel>
          <SectionHeader title="Structured screening" subtitle="Hard minimums are deterministic; review remains explicit." />
          <div className="space-y-3 p-5 pt-4 text-[11px]">
            <div className="flex justify-between"><span className="text-slate-500">Work authorization</span><Pill tone="green">Pass</Pill></div>
            <div className="flex justify-between"><span className="text-slate-500">5+ years relevant backend</span><Pill tone="amber">Needs review</Pill></div>
            <div className="flex justify-between"><span className="text-slate-500">Required location policy</span><Pill tone="green">Pass</Pill></div>
            <div className="rounded-[10px] bg-amber-50 p-3 text-[10px] leading-5 text-amber-800">A failed hard minimum creates an auditable review state; generative judgment does not silently reject the candidate.</div>
          </div>
        </Panel>

        <Panel>
          <SectionHeader title="Scheduling" subtitle="Calendar providers remain behind an integration boundary." />
          <div className="space-y-3 p-5 pt-4">
            <div className="rounded-[10px] border border-slate-100 p-3"><div className="text-[10px] text-slate-400">Ali Rahimi · Technical interview</div><div className="mt-1 text-[12px] font-semibold">Tue, 10 Sep · 11:00–12:00</div><div className="mt-2"><Pill tone="green">Confirmed</Pill></div></div>
            <div className="rounded-[10px] border border-slate-100 p-3"><div className="text-[10px] text-slate-400">Sara Mohammadi · Screening</div><div className="mt-1 text-[12px] font-semibold">Collecting availability</div><div className="mt-2"><Pill tone="blue">3 proposed slots</Pill></div></div>
          </div>
        </Panel>

        <Panel>
          <SectionHeader title="Reminder policy" subtitle="Candidate timezone and recovery state are explicit." />
          <div className="space-y-3 p-5 pt-4 text-[11px] text-slate-600">
            <div className="flex items-center gap-2"><Icon name="clock" size={14} className="text-indigo-600" /> 24 hours before interview</div>
            <div className="flex items-center gap-2"><Icon name="clock" size={14} className="text-indigo-600" /> 2 hours before interview</div>
            <div className="flex items-center gap-2"><Icon name="calendar" size={14} className="text-indigo-600" /> Candidate timezone: Asia/Tehran</div>
            <div className="rounded-[10px] bg-slate-50 p-3 text-[10px] text-slate-500">Provider callback failures preserve scheduling state for retry instead of losing the candidate flow.</div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

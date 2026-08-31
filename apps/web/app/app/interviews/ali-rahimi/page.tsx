import { Icon } from "../../../../components/product/icon";
import {
  DemoNotice,
  Panel,
  Pill,
  ProgressRing,
  ScoreBar,
  SectionHeader,
  ToolbarButton,
} from "../../../../components/product/recruiting-ui";

const flow: Array<{ label: string; time: string; done: boolean }> = [
  { label: "Introduction", time: "2:00", done: true },
  { label: "System Design", time: "5:32", done: true },
  { label: "Scalability", time: "8:15", done: true },
  { label: "Microservices", time: "active", done: false },
  { label: "Coding Challenge", time: "pending", done: false },
  { label: "Trade-offs", time: "pending", done: false },
  { label: "Summary", time: "pending", done: false },
];

const highlights: Array<[string, string, string]> = [
  ["12:42", "Explained distributed locking in detail", "Good understanding"],
  ["23:14", "Discussed Kubernetes scaling", "Strong explanation"],
  ["31:08", "System design trade-offs", "Impressive reasoning"],
];

export default function InterviewReview() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3 text-[9px] text-slate-400">
            <span>Interviews / AI Technical Interview</span>
            <DemoNotice />
          </div>
          <div className="mt-2 flex items-center gap-3">
            <h1 className="text-[21px] font-semibold">AI Technical Interview – Ali Rahimi</h1>
            <Pill tone="green">Completed</Pill>
          </div>
          <div className="mt-1 text-[9px] text-slate-500">Apr 28, 2026 · 42 min · AI Interviewer: Ava</div>
        </div>
        <div className="flex gap-2">
          <ToolbarButton icon="share">Share</ToolbarButton>
          <ToolbarButton icon="more">More</ToolbarButton>
          <ToolbarButton primary>View Scorecard</ToolbarButton>
        </div>
      </div>

      <div className="flex gap-6 overflow-x-auto border-b border-slate-200 text-[10px]">
        <span className="border-b-2 border-indigo-600 pb-3 font-semibold text-indigo-600">Summary</span>
        {["Transcript", "Questions", "Analysis", "Highlights", "Files"].map((item) => (
          <span key={item} className="pb-3 text-slate-500">{item}</span>
        ))}
      </div>

      <div className="grid gap-3 xl:grid-cols-[.9fr_1.15fr_1fr]">
        <Panel>
          <SectionHeader title="Overall interview score" subtitle="Evidence-backed interview result; not a final hiring decision." />
          <div className="flex flex-col items-center p-5 pt-3">
            <ProgressRing value={86} label="out of 100" tone="#10b981" />
            <div className="mt-3 text-[10px] font-semibold">Good Performance</div>
            <div className="mt-1 text-center text-[8px] text-slate-400">Strong evidence in the assessed technical criteria.</div>
          </div>
        </Panel>

        <Panel>
          <SectionHeader title="Score Breakdown" />
          <div className="space-y-3 p-5 pt-3">
            <ScoreBar label="Technical" value={91} />
            <ScoreBar label="System Design" value={89} />
            <ScoreBar label="Problem Solving" value={88} />
            <ScoreBar label="Communication" value={78} tone="amber" />
          </div>
        </Panel>

        <Panel>
          <SectionHeader title="AI Recommendation" subtitle="Decision support · reviewer approval required" />
          <div className="p-5 pt-3">
            <p className="text-[9px] leading-5 text-slate-600">Strong candidate evidence in technical concepts and system design.</p>
            <div className="mt-4 text-[8px] font-semibold text-slate-400">Recommended next step</div>
            <div className="mt-1 text-[11px] font-semibold text-emerald-700">Proceed to next round</div>
            <div className="mt-4 flex items-center justify-between gap-3">
              <span className="text-[8px] text-slate-400">Evidence confidence</span>
              <Pill tone="green">High</Pill>
            </div>
            <div className="mt-4 rounded-[9px] border border-indigo-100 bg-indigo-50/60 p-3 text-[9px] leading-5 text-indigo-800">
              Final advance, rejection and hiring decisions remain human-controlled and auditable.
            </div>
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.35fr_.65fr]">
        <Panel className="overflow-hidden">
          <div className="video-stage relative aspect-[16/7] min-h-[300px]">
            <div className="digital-human absolute inset-5 rounded-[14px] border border-white/10">
              <div className="absolute start-4 top-4 flex items-center gap-2 rounded-full bg-black/35 px-3 py-1 text-[9px] text-white">
                <span className="h-2 w-2 rounded-full bg-indigo-400" /> AI Interviewer
              </div>
              <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 bg-gradient-to-t from-black/80 to-transparent px-5 pb-4 pt-12 text-white">
                <button className="grid h-8 w-8 place-items-center rounded-full bg-white/15"><Icon name="play" size={14} /></button>
                <div className="h-1 flex-1 rounded bg-white/20"><div className="h-full w-[56%] rounded bg-indigo-400" /></div>
                <span className="text-[8px]">23:14 / 42:18</span>
              </div>
            </div>
          </div>
        </Panel>

        <Panel>
          <SectionHeader title="Interview flow" />
          <div className="space-y-3 p-5 pt-3">
            {flow.map((item, index) => (
              <div key={item.label} className="flex items-center gap-3 text-[9px]">
                <span className={`grid h-5 w-5 place-items-center rounded-full ${item.done ? "bg-emerald-50 text-emerald-600" : index === 3 ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-400"}`}>
                  {item.done ? <Icon name="check" size={10} /> : index + 1}
                </span>
                <span className="flex-1">{item.label}</span>
                <span className="text-slate-400">{item.time}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel>
        <SectionHeader title="Key highlights" action={<span className="text-[8px] font-semibold text-indigo-600">View all highlights →</span>} />
        <div className="grid gap-3 p-5 pt-3 md:grid-cols-3">
          {highlights.map(([time, title, note], index) => (
            <div key={time}>
              <div className={`h-28 rounded-[10px] ${index === 1 ? "bg-gradient-to-br from-slate-900 via-indigo-950 to-cyan-950" : "digital-human"}`} />
              <div className="mt-2 text-[8px] font-semibold">{time}</div>
              <div className="mt-1 text-[9px] font-medium">{title}</div>
              <div className="mt-1 text-[8px] text-emerald-600">{note}</div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

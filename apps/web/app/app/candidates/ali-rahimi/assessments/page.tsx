import Link from "next/link";
import { Icon } from "../../../../../components/product/icon";
import {
  DemoNotice,
  Panel,
  PersonAvatar,
  Pill,
  ScoreBar,
  SectionHeader,
  ToolbarButton,
} from "../../../../../components/product/recruiting-ui";

const tests = [
  ["API correctness", 100],
  ["Concurrency safety", 87],
  ["Data modeling", 92],
  ["Error handling", 84],
] as const;

export default function CandidateAssessmentsPage() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <PersonAvatar name="Ali Rahimi" size={48} />
          <div>
            <div className="mb-1 flex flex-wrap items-center gap-3"><span className="text-[10px] font-medium text-indigo-600">Candidate Intelligence · Assessments</span><DemoNotice /></div>
            <h1 className="text-[24px] font-semibold tracking-tight">Ali Rahimi</h1>
            <div className="mt-1 text-[11px] text-slate-500">Senior Backend Engineer · assessment evidence</div>
          </div>
        </div>
        <div className="flex gap-2">
          <ToolbarButton href="/app/candidates/ali-rahimi">Back to profile</ToolbarButton>
          <ToolbarButton href="/app/jobs/senior-backend-engineer/scorecards" primary icon="check">Review in scorecard</ToolbarButton>
        </div>
      </div>

      <div className="flex gap-6 overflow-x-auto border-b border-slate-200 text-[11px]">
        <Link href="/app/candidates/ali-rahimi" className="pb-3 text-slate-500">Overview</Link>
        {["Experience", "Skills", "Job Matches", "Screening"].map((item) => <span key={item} className="pb-3 text-slate-400">{item}</span>)}
        <Link href="/app/interviews/ali-rahimi" className="pb-3 text-slate-500 hover:text-slate-800">Interviews</Link>
        <span className="border-b-2 border-indigo-600 pb-3 font-semibold text-indigo-600">Assessments</span>
        {["Communications", "Notes", "Activity"].map((item) => <span key={item} className="pb-3 text-slate-400">{item}</span>)}
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.1fr_.9fr]">
        <Panel>
          <SectionHeader title="Backend production exercise · v2" subtitle="Submitted yesterday · isolated runner v1 · candidate notice displayed" action={<Pill tone="green">Completed</Pill>} />
          <div className="grid gap-4 p-5 pt-4 md:grid-cols-[160px_1fr]">
            <div className="rounded-[12px] bg-indigo-50 p-5 text-center">
              <div className="text-[10px] font-medium text-indigo-600">Normalized result</div>
              <div className="mt-2 text-[38px] font-semibold tracking-[-.05em] text-indigo-950">91</div>
              <div className="mt-1 text-[10px] text-indigo-600">/ 100</div>
              <div className="mt-4"><Pill tone="green">29 / 32 tests</Pill></div>
            </div>
            <div className="space-y-3">
              {tests.map(([label, value]) => <ScoreBar key={label} label={label} value={value} tone={value >= 90 ? "emerald" : "indigo"} />)}
              <div className="rounded-[10px] border border-slate-100 bg-slate-50 p-3 text-[10px] leading-5 text-slate-500">Result data comes from a runner boundary. Candidate code is never executed inside the core NestJS API process.</div>
            </div>
          </div>
        </Panel>

        <Panel>
          <SectionHeader title="Evidence created" subtitle="Assessment results become evidence; they do not bypass the rubric or human review." />
          <div className="space-y-2 p-5 pt-4">
            {[["Database transaction handling", "assessment:test-group:transactions", "green"], ["Idempotent retry behavior", "assessment:test-group:retries", "green"], ["Race-condition mitigation", "assessment:test-group:concurrency", "blue"], ["Operational diagnostics", "review note · manual evidence", "amber"]].map(([title, ref, tone]) => (
              <div key={title} className="rounded-[11px] border border-slate-100 p-3.5">
                <div className="flex items-center justify-between gap-3"><div className="text-[11px] font-semibold">{title}</div><Pill tone={tone as "green" | "blue" | "amber"}>Evidence</Pill></div>
                <div className="mt-1 text-[9px] text-slate-400">{ref}</div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <Panel>
          <SectionHeader title="Runner boundary" />
          <div className="space-y-3 p-5 pt-4 text-[11px] text-slate-600">
            <div className="flex items-center gap-2"><Icon name="shield" size={14} className="text-emerald-600" /> Isolated process/container/worker boundary required</div>
            <div className="flex items-center gap-2"><Icon name="shield" size={14} className="text-emerald-600" /> Network disabled unless assessment policy explicitly permits it</div>
            <div className="flex items-center gap-2"><Icon name="clock" size={14} className="text-indigo-600" /> CPU/time/memory limits are runner policy</div>
            <div className="flex items-center gap-2"><Icon name="target" size={14} className="text-indigo-600" /> Structured runner result maps into evidence/rubric evaluation</div>
          </div>
        </Panel>

        <Panel>
          <SectionHeader title="Integrity signals" subtitle="Review aids only; not automatic misconduct findings." />
          <div className="space-y-3 p-5 pt-4">
            <div className="flex items-center justify-between rounded-[10px] border border-slate-100 p-3"><span className="text-[11px]">Window-focus changes</span><Pill tone="slate">2 signals</Pill></div>
            <div className="flex items-center justify-between rounded-[10px] border border-slate-100 p-3"><span className="text-[11px]">Paste events</span><Pill tone="slate">1 signal</Pill></div>
            <div className="rounded-[10px] bg-amber-50 p-3 text-[10px] leading-5 text-amber-800">Candidate notice and policy context must be visible before any integrity signal is collected or reviewed.</div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

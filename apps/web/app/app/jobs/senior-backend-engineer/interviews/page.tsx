import { jobTabs } from "../../../../../lib/demo-data";
import { Icon } from "../../../../../components/product/icon";
import {
  DemoNotice,
  Panel,
  Pill,
  SectionHeader,
  ToolbarButton,
  WorkspaceTabs,
} from "../../../../../components/product/recruiting-ui";

const criteria = [
  ["Production debugging", "4 evidence objectives", "Covered"],
  ["System design", "3 evidence objectives", "Covered"],
  ["Kubernetes", "logs · events · metrics · root cause", "Needs depth"],
  ["Communication", "clarity · trade-offs · decisions", "Covered"],
] as const;

export default function JobInterviewsPage() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-3"><span className="text-[10px] font-medium text-indigo-600">Senior Backend Engineer · Interview subsystem</span><DemoNotice /></div>
          <h1 className="text-[26px] font-semibold tracking-tight">AI interview plan & release boundary</h1>
          <p className="mt-1 text-[12px] text-slate-500">Controlled question strategy, evidence coverage, consent/recovery requirements and explicit production lifecycle.</p>
        </div>
        <div className="flex gap-2"><ToolbarButton icon="columns">Rubric v3</ToolbarButton><ToolbarButton primary icon="play">Internal test</ToolbarButton></div>
      </div>

      <WorkspaceTabs tabs={jobTabs} active="Interviews" />

      <div className="grid gap-3 xl:grid-cols-[1.15fr_.85fr]">
        <Panel>
          <SectionHeader title="Interview plan · v4" subtitle="Derived from Job + Rubric + seniority + candidate history + time budget + organization policy." action={<Pill tone="blue">45 minutes</Pill>} />
          <div className="space-y-2 p-5 pt-4">
            {criteria.map(([criterion, objective, state], index) => (
              <div key={criterion} className="grid gap-3 rounded-[11px] border border-slate-100 p-4 md:grid-cols-[32px_1fr_auto] md:items-center">
                <div className="grid h-8 w-8 place-items-center rounded-[9px] bg-indigo-50 text-[11px] font-semibold text-indigo-700">{index + 1}</div>
                <div><div className="text-[12px] font-semibold">{criterion}</div><div className="mt-1 text-[10px] text-slate-500">{objective}</div></div>
                <Pill tone={state === "Covered" ? "green" : "amber"}>{state}</Pill>
              </div>
            ))}
          </div>
        </Panel>

        <div className="space-y-3">
          <Panel>
            <SectionHeader title="Release unit" subtitle="Approval is scoped to job family + language + interview type + rubric + policy + speech/avatar + evaluator versions." />
            <div className="space-y-3 p-5 pt-4">
              <div className="flex items-center justify-between"><span className="text-[11px] text-slate-500">Lifecycle</span><Pill tone="amber">DEV_ONLY</Pill></div>
              <div className="flex items-center justify-between"><span className="text-[11px] text-slate-500">Language</span><span className="text-[11px] font-semibold">Persian + technical English</span></div>
              <div className="flex items-center justify-between"><span className="text-[11px] text-slate-500">Policy</span><span className="text-[11px] font-semibold">interviewer-policy v1</span></div>
              <div className="flex items-center justify-between"><span className="text-[11px] text-slate-500">Evaluator</span><span className="text-[11px] font-semibold">evaluator v3</span></div>
              <div className="rounded-[10px] border border-amber-100 bg-amber-50 p-3 text-[10px] leading-5 text-amber-800">Real-candidate autonomous interviews remain blocked until the release unit passes production-readiness gates and has an explicit approval record.</div>
            </div>
          </Panel>

          <Panel>
            <SectionHeader title="Brain / media separation" />
            <div className="p-5 pt-4">
              <div className="flex flex-wrap items-center gap-2 text-[10px] font-medium text-slate-600">
                {["Interview Brain", "spoken_text", "TTSProvider", "AvatarProvider", "Candidate"].map((item, index) => <div key={item} className="contents"><span className="rounded-[9px] border border-slate-100 bg-slate-50 px-3 py-2">{item}</span>{index < 4 ? <Icon name="arrow" size={13} className="text-slate-300" /> : null}</div>)}
              </div>
              <p className="mt-4 text-[10px] leading-5 text-slate-500">Avatar presentation never owns interview intelligence. Only approved structured-turn spoken text reaches TTS/avatar.</p>
            </div>
          </Panel>
        </div>
      </div>

      <Panel>
        <SectionHeader title="Session readiness" subtitle="Candidate-facing consent/device/recovery states are required before a real interview session." />
        <div className="grid gap-3 p-5 pt-4 sm:grid-cols-2 xl:grid-cols-5">
          {[
            ["Consent", "Required", "shield"],
            ["Device check", "Required", "interviews"],
            ["Transcript", "Final + streaming", "message"],
            ["Reconnect", "Checkpointed", "automation"],
            ["Evaluator", "Independent", "brain"],
          ].map(([label, state, icon]) => (
            <div key={label} className="rounded-[11px] border border-slate-100 p-4">
              <div className="grid h-8 w-8 place-items-center rounded-[9px] bg-indigo-50 text-indigo-600"><Icon name={icon as "shield" | "interviews" | "message" | "automation" | "brain"} size={14} /></div>
              <div className="mt-3 text-[11px] font-semibold">{label}</div><div className="mt-1 text-[10px] text-slate-500">{state}</div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

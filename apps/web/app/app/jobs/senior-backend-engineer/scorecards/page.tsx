import { jobTabs } from "../../../../../lib/demo-data";
import { Icon } from "../../../../../components/product/icon";
import {
  Panel,
  Pill,
  ScoreBar,
  SectionHeader,
  ToolbarButton,
  WorkspaceTabs,
} from "../../../../../components/product/recruiting-ui";

const criteria = [
  { label: "Backend engineering", score: 92, evidence: 5, status: "Reviewed" },
  { label: "System design", score: 88, evidence: 4, status: "Reviewed" },
  { label: "Production debugging", score: 84, evidence: 3, status: "Reviewed" },
  { label: "Communication", score: 79, evidence: 2, status: "Needs review" },
];

export default function JobScorecardsPage() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 text-[10px] font-medium text-indigo-600">Senior Backend Engineer · Decision support</div>
          <h1 className="text-[26px] font-semibold tracking-tight">Scorecards & evidence</h1>
          <p className="mt-1 text-[12px] text-slate-500">
            Evidence-backed criterion evaluation with deterministic weighted scoring and human override history.
          </p>
        </div>
        <div className="flex gap-2">
          <ToolbarButton icon="columns">Compare candidates</ToolbarButton>
          <ToolbarButton primary icon="check">Review pending scores</ToolbarButton>
        </div>
      </div>

      <WorkspaceTabs tabs={jobTabs} active="Scorecards" />

      <div className="grid gap-3 xl:grid-cols-[1.05fr_.95fr]">
        <Panel>
          <SectionHeader
            title="Ali Rahimi · rubric v3"
            subtitle="Final score is calculated by weighted domain code after every required criterion has evidence."
            action={<Pill tone="amber">Human review pending</Pill>}
          />
          <div className="space-y-4 p-5 pt-4">
            {criteria.map((criterion) => (
              <div key={criterion.label} className="rounded-[11px] border border-slate-100 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[12px] font-semibold text-slate-900">{criterion.label}</div>
                    <div className="mt-1 text-[10px] text-slate-500">{criterion.evidence} evidence references</div>
                  </div>
                  <Pill tone={criterion.status === "Reviewed" ? "green" : "amber"}>{criterion.status}</Pill>
                </div>
                <ScoreBar label="Criterion score" value={criterion.score} tone={criterion.score >= 85 ? "emerald" : "indigo"} />
              </div>
            ))}
          </div>
        </Panel>

        <div className="space-y-3">
          <Panel>
            <SectionHeader title="Evidence coverage" subtitle="Missing evidence blocks a consequential overall score." />
            <div className="grid grid-cols-2 gap-3 p-5 pt-4">
              <div className="rounded-[11px] bg-emerald-50 p-4">
                <div className="text-[10px] font-medium text-emerald-700">Required criteria covered</div>
                <div className="mt-2 text-[28px] font-semibold text-emerald-950">4 / 4</div>
              </div>
              <div className="rounded-[11px] bg-indigo-50 p-4">
                <div className="text-[10px] font-medium text-indigo-700">Evidence references</div>
                <div className="mt-2 text-[28px] font-semibold text-indigo-950">14</div>
              </div>
            </div>
          </Panel>

          <Panel>
            <SectionHeader title="Decision boundary" />
            <div className="space-y-3 p-5 pt-4 text-[11px] leading-5 text-slate-600">
              <div className="flex gap-2"><Icon name="check" size={14} className="mt-0.5 text-emerald-600" /> AI may draft criterion evaluations from evidence.</div>
              <div className="flex gap-2"><Icon name="check" size={14} className="mt-0.5 text-emerald-600" /> Weighted overall score is deterministic domain logic.</div>
              <div className="flex gap-2"><Icon name="candidates" size={14} className="mt-0.5 text-indigo-600" /> Final hiring/rejection remains human-controlled.</div>
              <div className="rounded-[10px] border border-slate-100 bg-slate-50 p-3 text-[10px] text-slate-500">
                Any override must preserve previous value, new value, reviewer, reason and timestamp.
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

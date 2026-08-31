import { candidates, jobTabs } from "../../../../../lib/demo-data";
import { Icon } from "../../../../../components/product/icon";
import {
  DemoNotice,
  Panel,
  PersonAvatar,
  Pill,
  SectionHeader,
  ToolbarButton,
  WorkspaceTabs,
} from "../../../../../components/product/recruiting-ui";

const sources = [
  ["Internal Talent Pool", "Active", "First source", "No external approval required"],
  ["ATS Adapter", "Ready", "Approved integration", "Tenant-scoped connector"],
  ["Approved Job Boards", "Policy check", "External", "Run only through configured adapters"],
  ["Approved External Sources", "Restricted", "External", "No hidden scraping"],
] as const;

export default function JobSourcingPage() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <span className="text-[10px] font-medium text-indigo-600">Senior Backend Engineer · AI sourcing agent</span>
            <DemoNotice />
          </div>
          <h1 className="text-[26px] font-semibold tracking-tight">Sourcing</h1>
          <p className="mt-1 text-[12px] text-slate-500">Internal-first discovery, approved source adapters, deduplication review and explainable retrieval signals.</p>
        </div>
        <div className="flex gap-2">
          <ToolbarButton icon="filter">Edit search strategy</ToolbarButton>
          <ToolbarButton primary icon="sparkles">Run approved search</ToolbarButton>
        </div>
      </div>

      <WorkspaceTabs tabs={jobTabs} active="Sourcing" />

      <div className="grid gap-3 xl:grid-cols-[1.1fr_.9fr]">
        <Panel>
          <SectionHeader title="AI search strategy" subtitle="Retrieval is broad; final candidate fit remains a separate evidence-backed evaluation." />
          <div className="grid gap-3 p-5 pt-4 md:grid-cols-2">
            <div className="rounded-[11px] border border-slate-100 p-4">
              <div className="text-[10px] font-semibold uppercase tracking-[.12em] text-slate-400">Titles</div>
              <div className="mt-3 flex flex-wrap gap-2">{["Senior Backend Engineer", "Backend Lead", ".NET Engineer", "Platform Engineer"].map((item) => <Pill key={item} tone="blue">{item}</Pill>)}</div>
            </div>
            <div className="rounded-[11px] border border-slate-100 p-4">
              <div className="text-[10px] font-semibold uppercase tracking-[.12em] text-slate-400">Skills & context</div>
              <div className="mt-3 flex flex-wrap gap-2">{[".NET", "C#", "SQL", "Kubernetes", "production debugging", "microservices"].map((item) => <Pill key={item} tone="violet">{item}</Pill>)}</div>
            </div>
          </div>
          <div className="border-t border-slate-100 px-5 py-4 text-[10px] text-slate-500">Semantic/vector similarity is a retrieval signal only. It is never converted directly into a final hiring percentage.</div>
        </Panel>

        <Panel>
          <SectionHeader title="Source policy" subtitle="Adapters are explicit capabilities with lawful/approved access boundaries." />
          <div className="space-y-2 p-5 pt-4">
            {sources.map(([name, state, kind, note], index) => (
              <div key={name} className="flex items-start gap-3 rounded-[11px] border border-slate-100 p-3.5">
                <div className={`grid h-8 w-8 place-items-center rounded-[9px] ${index === 0 ? "bg-emerald-50 text-emerald-600" : "bg-indigo-50 text-indigo-600"}`}><Icon name={index === 0 ? "talent" : "integrations"} size={14} /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3"><span className="text-[11px] font-semibold">{name}</span><Pill tone={state === "Active" ? "green" : state === "Restricted" ? "amber" : "slate"}>{state}</Pill></div>
                  <div className="mt-1 text-[10px] text-slate-400">{kind} · {note}</div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel>
        <SectionHeader title="Discovered candidates" subtitle="Development discoveries exercise dedupe and review anatomy; strong identity matches are auto-resolved while ambiguous merges require human review." action={<span className="text-[10px] font-semibold text-indigo-600">Saved view · New discoveries</span>} />
        <div className="overflow-x-auto pt-3">
          <table className="data-table">
            <thead><tr>{["Candidate", "Source", "Retrieval", "Why surfaced", "Identity", "Review"].map((head) => <th key={head}>{head}</th>)}</tr></thead>
            <tbody>
              {candidates.slice(0, 5).map((candidate, index) => (
                <tr key={candidate.id}>
                  <td><div className="flex items-center gap-2"><PersonAvatar name={candidate.name} size={30} tone={candidate.tone} /><div><div className="font-semibold text-slate-900">{candidate.name}</div><div className="text-[9px] text-slate-400">{candidate.role} · {candidate.company}</div></div></div></td>
                  <td>{index < 2 ? "Talent Pool" : candidate.source}</td>
                  <td><Pill tone="blue">{(0.94 - index * 0.06).toFixed(2)}</Pill></td>
                  <td>{candidate.skills.slice(0, 2).join(" + ")} · role context</td>
                  <td><Pill tone={index === 3 ? "amber" : "green"}>{index === 3 ? "Merge review" : "Resolved"}</Pill></td>
                  <td><button className="text-[10px] font-semibold text-indigo-600">Review evidence →</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

import Link from "next/link";
import { candidates } from "../../../lib/demo-data";
import { Icon } from "../../../components/product/icon";
import { Panel, PersonAvatar, Pill, ToolbarButton } from "../../../components/product/recruiting-ui";

const views = ["All Candidates", "New", "Active Processes", "Interviewed", "Talent Pool", "Archived", "Saved Views"] as const;

export default function CandidatesPage() {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1 text-[11px] font-medium text-indigo-600">Candidate intelligence</div>
          <h1 className="text-[28px] font-semibold tracking-[-.03em] text-slate-950">Candidates</h1>
          <p className="mt-1.5 text-[12px] text-slate-500">Organization-wide talent intelligence and active hiring relationships.</p>
        </div>
        <ToolbarButton primary icon="plus">Add Candidate</ToolbarButton>
      </div>

      <Panel>
        <div className="flex gap-7 overflow-x-auto border-b border-slate-200 px-5 pt-4 text-[11px]">
          {views.map((view, index) => (
            <span
              key={view}
              className={`relative whitespace-nowrap pb-3 font-medium ${index === 0 ? "text-indigo-600" : "text-slate-500"}`}
            >
              {view}
              {index === 0 ? <span className="absolute inset-x-0 bottom-0 h-[2px] bg-indigo-600" /> : null}
            </span>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-4">
          <div className="relative min-w-[280px] flex-1">
            <Icon name="search" size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="h-10 w-full rounded-[10px] border border-slate-200 bg-slate-50 pl-10 pr-3 text-[11px] outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:bg-white focus:ring-4 focus:ring-indigo-50"
              placeholder="Search candidates by name, skill, company or role..."
            />
          </div>
          <ToolbarButton icon="filter">Filters</ToolbarButton>
          <ToolbarButton>Saved Views</ToolbarButton>
          <ToolbarButton icon="columns">Columns</ToolbarButton>
        </div>

        <div className="overflow-x-auto">
          <table className="data-table min-w-[1040px]">
            <thead>
              <tr>
                {["Candidate", "Current Role", "Skills", "Match", "Stage", "Source", "Owner", "Updated"].map((heading) => (
                  <th key={heading}>{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {candidates.map((candidate) => (
                <tr key={candidate.id}>
                  <td>
                    <Link href={`/app/candidates/${candidate.id}`} className="flex items-center gap-3">
                      <PersonAvatar name={candidate.name} size={32} tone={candidate.tone} />
                      <div>
                        <div className="font-semibold text-slate-900">{candidate.name}</div>
                        <div className="mt-1 text-[9px] text-slate-400">Candidate intelligence profile</div>
                      </div>
                    </Link>
                  </td>
                  <td className="font-medium text-slate-700">{candidate.role}</td>
                  <td>
                    <div className="max-w-[220px] truncate" title={candidate.skills.join(", ")}>
                      {candidate.skills.join(", ")}
                    </div>
                  </td>
                  <td>
                    <Pill tone={candidate.match >= 85 ? "green" : "blue"}>{candidate.match}%</Pill>
                  </td>
                  <td>
                    <Pill tone={candidate.stage === "Interview" ? "violet" : candidate.stage === "Screening" ? "blue" : "slate"}>
                      {candidate.stage}
                    </Pill>
                  </td>
                  <td>{candidate.source}</td>
                  <td>{candidate.owner}</td>
                  <td>{candidate.updated}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 text-[10px] text-slate-400">
          <span>1–6 of 342 candidates</span>
          <div className="flex items-center gap-1.5">
            <span className="grid h-8 w-8 place-items-center rounded-[8px] bg-indigo-600 font-semibold text-white">1</span>
            <span className="grid h-8 w-8 place-items-center rounded-[8px] hover:bg-slate-50">2</span>
            <span className="grid h-8 w-8 place-items-center rounded-[8px] hover:bg-slate-50">3</span>
            <span className="px-1">…</span>
            <span className="grid h-8 w-8 place-items-center rounded-[8px] hover:bg-slate-50">65</span>
          </div>
        </div>
      </Panel>
    </div>
  );
}

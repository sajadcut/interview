import { candidates } from "../../../lib/demo-data";
import { Icon } from "../../../components/product/icon";
import { Panel, PersonAvatar, Pill, SectionHeader, ToolbarButton } from "../../../components/product/recruiting-ui";

export default function TalentPage() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 text-[10px] font-medium text-indigo-600">Organization talent intelligence</div>
          <h1 className="text-[26px] font-semibold tracking-tight">Talent Pool</h1>
          <p className="mt-1 text-[12px] text-slate-500">Rediscover previous applicants and passive candidates before expanding to external sourcing.</p>
        </div>
        <div className="flex gap-2"><ToolbarButton icon="filter">Saved segments</ToolbarButton><ToolbarButton primary icon="plus">Add candidate</ToolbarButton></div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Active talent", "1,284", "candidates"],
          ["Previous finalists", "86", "target"],
          ["Rediscovery matches", "42", "sparkles"],
          ["Merge reviews", "7", "shield"],
        ].map(([label, value, icon]) => (
          <Panel key={label} className="p-5"><div className="flex items-start justify-between"><div><div className="text-[11px] font-medium text-slate-500">{label}</div><div className="mt-2 text-[28px] font-semibold tracking-tight">{value}</div></div><div className="grid h-9 w-9 place-items-center rounded-[10px] bg-indigo-50 text-indigo-600"><Icon name={icon as "candidates" | "target" | "sparkles" | "shield"} size={15} /></div></div></Panel>
        ))}
      </div>

      <Panel>
        <SectionHeader title="Rediscovery candidates" subtitle="Organization-global candidate records; job-specific lifecycle stays in Application." action={<span className="text-[10px] font-semibold text-indigo-600">Internal source first</span>} />
        <div className="overflow-x-auto pt-3">
          <table className="data-table">
            <thead><tr>{["Candidate", "Current role", "Prior relationship", "Evidence", "Potential jobs", "Identity"].map((head) => <th key={head}>{head}</th>)}</tr></thead>
            <tbody>{candidates.map((candidate, index) => (
              <tr key={candidate.id}>
                <td><div className="flex items-center gap-2"><PersonAvatar name={candidate.name} size={30} tone={candidate.tone} /><div><div className="font-semibold text-slate-900">{candidate.name}</div><div className="text-[9px] text-slate-400">{candidate.company}</div></div></div></td>
                <td>{candidate.role}</td>
                <td>{index % 2 === 0 ? "Previous applicant" : "Sourced prospect"}</td>
                <td>{candidate.skills.slice(0, 2).join(", ")}</td>
                <td><Pill tone="blue">{index % 3 + 1} jobs</Pill></td>
                <td><Pill tone={index === 4 ? "amber" : "green"}>{index === 4 ? "Review merge" : "Resolved"}</Pill></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-3 xl:grid-cols-2">
        <Panel><SectionHeader title="Identity resolution" /><div className="p-5 pt-4 text-[11px] leading-5 text-slate-600">Strong identifiers may resolve automatically. Supporting signals can suggest a merge, but ambiguous candidate identity merges require a human review record.</div></Panel>
        <Panel><SectionHeader title="Source boundary" /><div className="p-5 pt-4 text-[11px] leading-5 text-slate-600">Talent Pool is searched before ATS/job-board/external adapters. LinkedIn or other platforms are never assumed scrapeable; access must be lawful and authorized.</div></Panel>
      </div>
    </div>
  );
}

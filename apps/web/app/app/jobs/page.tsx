import Link from "next/link";
import { Icon } from "../../../components/product/icon";
import { Panel, Pill, ToolbarButton } from "../../../components/product/recruiting-ui";

const jobs = [
  ["Senior Backend Engineer", "Engineering", "Tehran / Remote", "126", "Open", "12 days"],
  ["DevOps Engineer", "Engineering", "Remote", "64", "Open", "7 days"],
  ["Product Designer", "Product", "Tehran", "42", "Open", "4 days"],
  ["Data Engineer", "Data", "Remote", "88", "Review", "18 days"],
] as const;

export default function JobsPage() {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1 text-[11px] font-medium text-indigo-600">Hiring workspaces</div>
          <h1 className="text-[28px] font-semibold tracking-[-.03em] text-slate-950">Jobs</h1>
          <p className="mt-1.5 text-[12px] text-slate-500">Create, monitor and optimize every hiring workspace.</p>
        </div>
        <Link href="/app/jobs/new">
          <ToolbarButton primary icon="plus">Create Job</ToolbarButton>
        </Link>
      </div>

      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-4">
          <div className="relative min-w-[260px] flex-1">
            <Icon name="search" size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="h-10 w-full rounded-[10px] border border-slate-200 bg-slate-50 pl-10 pr-3 text-[11px] outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:bg-white focus:ring-4 focus:ring-indigo-50"
              placeholder="Search jobs by title, team or location..."
            />
          </div>
          <ToolbarButton icon="filter">Filters</ToolbarButton>
          <ToolbarButton icon="columns">Columns</ToolbarButton>
          <ToolbarButton>Saved views</ToolbarButton>
        </div>

        <div className="overflow-x-auto">
          <table className="data-table min-w-[860px]">
            <thead>
              <tr>
                {["Job", "Department", "Location", "Candidates", "Status", "Days open", ""].map((heading) => (
                  <th key={heading}>{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {jobs.map((job, index) => (
                <tr key={job[0]}>
                  <td>
                    <div>
                      <Link
                        className="font-semibold text-slate-900 hover:text-indigo-600"
                        href={index === 0 ? "/app/jobs/senior-backend-engineer" : "/app/jobs"}
                      >
                        {job[0]}
                      </Link>
                      <div className="mt-1 text-[9px] text-slate-400">Structured hiring workspace</div>
                    </div>
                  </td>
                  <td>{job[1]}</td>
                  <td>{job[2]}</td>
                  <td className="font-semibold text-slate-700">{job[3]}</td>
                  <td>
                    <Pill tone={job[4] === "Open" ? "green" : "amber"}>{job[4]}</Pill>
                  </td>
                  <td>{job[5]}</td>
                  <td className="text-right font-semibold tracking-widest text-slate-400">•••</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-[10px] text-slate-400">
          <span>4 jobs shown · fixture-backed workspace</span>
          <span className="font-medium text-slate-500">Sort: Recently updated</span>
        </div>
      </Panel>
    </div>
  );
}

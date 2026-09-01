import Link from "next/link";
import type { ReactNode } from "react";

export default function InterviewerLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[.16em] text-indigo-600">Interview Platform</div>
            <div className="text-sm font-semibold text-slate-950">Interviewer workspace</div>
          </div>
          <nav className="flex items-center gap-2 text-xs font-semibold text-slate-600">
            <Link className="rounded-lg px-3 py-2 hover:bg-slate-100" href="/interviewer">Today</Link>
            <Link className="rounded-lg px-3 py-2 hover:bg-slate-100" href="/interviewer/interviews">My interviews</Link>
            <Link className="rounded-lg px-3 py-2 hover:bg-slate-100" href="/interviewer/scorecard">Scorecards</Link>
            <Link className="rounded-lg px-3 py-2 hover:bg-slate-100" href="/app">Main app</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}

import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon";

const primary: Array<[string,string,IconName,string?]> = [
  ["Home","/app","home"], ["Jobs","/app/jobs","jobs"], ["Candidates","/app/candidates","candidates"], ["Talent Pool","/app/talent","talent"],
  ["Interviews","/app/interviews","interviews"], ["Inbox","/app/inbox","inbox","8"], ["Analytics","/app/analytics","analytics"],
];
const secondary: Array<[string,string,IconName]> = [["Automations","/app/automations","automation"],["Integrations","/app/integrations","integrations"],["Settings","/app/settings","settings"]];

function NavItem({ item }: { item: [string,string,IconName,string?] }) {
  const [label,href,icon,count] = item;
  return <Link href={href} className="group flex h-10 items-center gap-3 rounded-[9px] px-3 text-[12px] font-medium text-slate-300 transition hover:bg-white/8 hover:text-white"><Icon name={icon} size={16}/><span className="flex-1">{label}</span>{count ? <span className="rounded-full bg-indigo-500/25 px-2 py-0.5 text-[9px] text-indigo-200">{count}</span> : null}</Link>;
}

export function AppShell({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-[#f5f7fb] text-slate-900 lg:grid lg:grid-cols-[224px_minmax(0,1fr)]" dir="ltr">
    <aside className="hidden min-h-screen bg-[#101827] px-3 py-4 text-white lg:sticky lg:top-0 lg:block lg:h-screen">
      <div className="mb-6 flex items-center gap-3 px-2"><div className="grid h-9 w-9 place-items-center rounded-[10px] bg-gradient-to-br from-indigo-500 to-violet-500 shadow-lg shadow-indigo-950/30"><Icon name="sparkles" size={17}/></div><div><div className="text-[13px] font-semibold">AI Recruiter</div><div className="text-[9px] text-slate-400">Enterprise hiring OS</div></div></div>
      <nav className="space-y-1">{primary.map((item)=><NavItem key={item[1]} item={item}/>)}</nav>
      <div className="my-4 border-t border-white/10"/>
      <div className="mb-2 px-3 text-[8px] font-semibold uppercase tracking-[.18em] text-slate-500">Automation</div>
      <nav className="space-y-1">{secondary.map((item)=><NavItem key={item[1]} item={item}/>)}</nav>
      <div className="absolute inset-x-3 bottom-4 flex items-center gap-3 rounded-[10px] border border-white/10 bg-white/[.04] p-3"><div className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-amber-100 to-violet-200 text-[10px] font-bold text-slate-800">SN</div><div className="min-w-0 flex-1"><div className="truncate text-[10px] font-semibold">Sara Noroozi</div><div className="text-[8px] text-slate-400">Recruiter</div></div><Icon name="chevron" size={13}/></div>
    </aside>
    <div className="min-w-0">
      <header className="sticky top-0 z-30 flex h-[58px] items-center gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-6"><div className="flex min-w-0 flex-1 items-center"><div className="relative hidden w-full max-w-md md:block"><Icon name="search" size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input className="h-9 w-full rounded-[9px] border border-slate-200 bg-slate-50 pl-9 pr-3 text-[11px] outline-none transition focus:border-indigo-300 focus:bg-white" placeholder="Search candidates, jobs, interviews..."/></div></div><button className="hidden h-9 items-center gap-2 rounded-[9px] border border-indigo-100 bg-indigo-50 px-3 text-[10px] font-semibold text-indigo-700 sm:inline-flex"><Icon name="sparkles" size={14}/>Ask AI</button><Link href="/app/jobs/new" className="inline-flex h-9 items-center gap-2 rounded-[9px] bg-indigo-600 px-3 text-[10px] font-semibold text-white shadow-sm"><Icon name="plus" size={14}/>Create Job</Link><button className="relative grid h-9 w-9 place-items-center rounded-[9px] border border-slate-200 bg-white text-slate-600"><Icon name="bell" size={15}/><span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-white"/></button><div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-amber-100 to-violet-200 text-[10px] font-bold">SN</div></header>
      <main className="mx-auto max-w-[1520px] p-4 sm:p-5 lg:p-6">{children}</main>
    </div>
  </div>;
}

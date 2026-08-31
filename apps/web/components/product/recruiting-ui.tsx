import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { Icon, type IconName } from "./icon";

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-[14px] border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,.025)] ${className}`}>{children}</section>;
}

export function SectionHeader({ title, action, subtitle }: { title: string; action?: ReactNode; subtitle?: string }) {
  return <div className="flex items-start justify-between gap-4 px-5 pt-5"><div><h2 className="text-[13px] font-semibold text-slate-950">{title}</h2>{subtitle ? <p className="mt-1 text-[11px] text-slate-500">{subtitle}</p> : null}</div>{action}</div>;
}

export function MetricCard({ icon, label, value, note, tone = "indigo" }: { icon: IconName; label: string; value: string; note: string; tone?: "indigo" | "violet" | "emerald" | "amber" }) {
  const tones = { indigo: "bg-indigo-50 text-indigo-600", violet: "bg-violet-50 text-violet-600", emerald: "bg-emerald-50 text-emerald-600", amber: "bg-amber-50 text-amber-600" } as const;
  return <Panel className="p-4"><div className="flex items-start gap-3"><div className={`grid h-9 w-9 place-items-center rounded-[10px] ${tones[tone]}`}><Icon name={icon} size={17}/></div><div className="min-w-0"><div className="text-[11px] text-slate-500">{label}</div><div className="mt-1 text-[22px] font-semibold tracking-tight text-slate-950">{value}</div><div className="mt-0.5 text-[10px] text-slate-500">{note}</div></div></div></Panel>;
}

export function Pill({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "green" | "blue" | "violet" | "amber" | "red" }) {
  const tones = { slate: "bg-slate-100 text-slate-600", green: "bg-emerald-50 text-emerald-700", blue: "bg-blue-50 text-blue-700", violet: "bg-violet-50 text-violet-700", amber: "bg-amber-50 text-amber-700", red: "bg-rose-50 text-rose-700" } as const;
  return <span className={`inline-flex items-center rounded-full px-2 py-1 text-[9px] font-semibold ${tones[tone]}`}>{children}</span>;
}

export function PersonAvatar({ name, size = 34, tone = 0 }: { name: string; size?: number; tone?: number }) {
  const palette = ["linear-gradient(145deg,#dbeafe,#c4b5fd)","linear-gradient(145deg,#fce7f3,#ddd6fe)","linear-gradient(145deg,#dcfce7,#bfdbfe)","linear-gradient(145deg,#fef3c7,#fed7aa)","linear-gradient(145deg,#e0e7ff,#ccfbf1)"];
  const initials = name.split(" ").slice(0,2).map((part)=>part[0]).join("").toUpperCase();
  return <div className="grid shrink-0 place-items-center rounded-full border border-white text-[10px] font-bold text-slate-700 shadow-sm" style={{ width: size, height: size, background: palette[tone % palette.length] }}>{initials}</div>;
}

export function ProgressRing({ value, label, size = 92, tone = "#4f46e5" }: { value: number; label?: string; size?: number; tone?: string }) {
  const style = { width: size, height: size, background: `conic-gradient(${tone} ${value * 3.6}deg,#edf0f5 0)` } as CSSProperties;
  return <div className="relative grid shrink-0 place-items-center rounded-full" style={style}><div className="absolute rounded-full bg-white" style={{ width: size - 12, height: size - 12 }}/><div className="relative text-center"><div className="text-[22px] font-semibold tracking-tight text-slate-950">{value}</div>{label ? <div className="mt-[-2px] text-[8px] font-medium text-slate-500">{label}</div> : null}</div></div>;
}

export function TinyTrend({ up = true }: { up?: boolean }) {
  return <span className={`text-[9px] font-semibold ${up ? "text-emerald-600" : "text-rose-500"}`}>{up ? "↗" : "↘"}</span>;
}

export function ToolbarButton({ children, primary = false, icon }: { children: ReactNode; primary?: boolean; icon?: IconName }) {
  return <button className={`inline-flex h-9 items-center gap-2 rounded-[9px] px-3 text-[11px] font-semibold transition ${primary ? "bg-indigo-600 text-white shadow-sm hover:bg-indigo-700" : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>{icon ? <Icon name={icon} size={15}/> : null}{children}</button>;
}

export function WorkspaceTabs({ tabs, active }: { tabs: Array<[string,string]>; active: string }) {
  return <nav className="flex gap-6 overflow-x-auto border-b border-slate-200 text-[11px] text-slate-500">{tabs.map(([label,href])=><Link key={href} href={href} className={`relative whitespace-nowrap pb-3 pt-1 font-medium ${label===active ? "text-indigo-600" : "hover:text-slate-800"}`}>{label}{label===active ? <span className="absolute inset-x-0 bottom-0 h-[2px] bg-indigo-600"/> : null}</Link>)}</nav>;
}

export function SkillChip({ children, verified = false }: { children: ReactNode; verified?: boolean }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[9px] font-semibold ${verified ? "bg-emerald-50 text-emerald-700" : "bg-indigo-50 text-indigo-700"}`}>{verified ? <Icon name="check" size={10}/> : null}{children}</span>;
}

export function ScoreBar({ label, value, tone = "emerald" }: { label: string; value: number; tone?: "emerald" | "indigo" | "amber" }) {
  const bar = tone === "indigo" ? "bg-indigo-500" : tone === "amber" ? "bg-amber-500" : "bg-emerald-500";
  return <div className="grid grid-cols-[110px_1fr_28px] items-center gap-3 text-[10px]"><span className="text-slate-600">{label}</span><div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${bar}`} style={{ width: `${value}%` }}/></div><span className="text-right font-semibold text-slate-700">{value}</span></div>;
}

export function EmptyChart({ label = "trend" }: { label?: string }) {
  return <svg viewBox="0 0 120 34" className="h-8 w-28" aria-label={label}><path d="M2 26 C20 25, 24 18, 38 20 S58 8,72 14 S94 6,118 8" fill="none" stroke="#6366f1" strokeWidth="2"/><path d="M2 32 C20 29,24 22,38 24 S58 12,72 18 S94 10,118 12" fill="none" stroke="#c7d2fe" strokeWidth="1.5"/></svg>;
}

export function DemoNotice() {
  return <div className="rounded-[9px] border border-indigo-100 bg-indigo-50/70 px-3 py-2 text-[10px] text-indigo-700"><strong>Development fixture:</strong> visual target data only. Domain APIs replace these fixtures during M1.</div>;
}

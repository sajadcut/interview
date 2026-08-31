import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { Icon, type IconName } from "./icon";

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-[13px] border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,.03),0_8px_24px_rgba(15,23,42,.025)] ${className}`}
    >
      {children}
    </section>
  );
}

export function SectionHeader({
  title,
  action,
  subtitle,
}: {
  title: string;
  action?: ReactNode;
  subtitle?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 pt-5">
      <div>
        <h2 className="text-[14px] font-semibold tracking-tight text-slate-950">{title}</h2>
        {subtitle ? <p className="mt-1 text-[11px] leading-5 text-slate-500">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function MetricCard({
  icon,
  label,
  value,
  note,
  tone = "indigo",
}: {
  icon: IconName;
  label: string;
  value: string;
  note: string;
  tone?: "indigo" | "violet" | "emerald" | "amber";
}) {
  const tones = {
    indigo: "bg-indigo-50 text-indigo-600",
    violet: "bg-violet-50 text-violet-600",
    emerald: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
  } as const;

  return (
    <Panel className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[11px] font-medium text-slate-500">{label}</div>
          <div className="mt-2 text-[28px] font-semibold leading-none tracking-[-.035em] text-slate-950">{value}</div>
          <div className="mt-2 text-[10px] text-slate-500">{note}</div>
        </div>
        <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-[11px] ${tones[tone]}`}>
          <Icon name={icon} size={18} />
        </div>
      </div>
    </Panel>
  );
}

export function Pill({
  children,
  tone = "slate",
}: {
  children: ReactNode;
  tone?: "slate" | "green" | "blue" | "violet" | "amber" | "red";
}) {
  const tones = {
    slate: "bg-slate-100 text-slate-600",
    green: "bg-emerald-50 text-emerald-700",
    blue: "bg-blue-50 text-blue-700",
    violet: "bg-violet-50 text-violet-700",
    amber: "bg-amber-50 text-amber-700",
    red: "bg-rose-50 text-rose-700",
  } as const;
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function PersonAvatar({ name, size = 34, tone = 0 }: { name: string; size?: number; tone?: number }) {
  const palette = [
    "linear-gradient(145deg,#dbeafe,#c4b5fd)",
    "linear-gradient(145deg,#fce7f3,#ddd6fe)",
    "linear-gradient(145deg,#dcfce7,#bfdbfe)",
    "linear-gradient(145deg,#fef3c7,#fed7aa)",
    "linear-gradient(145deg,#e0e7ff,#ccfbf1)",
  ];
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return (
    <div
      className="grid shrink-0 place-items-center rounded-full border border-white text-[10px] font-bold text-slate-700 shadow-sm ring-1 ring-slate-200/70"
      style={{ width: size, height: size, background: palette[tone % palette.length] }}
    >
      {initials}
    </div>
  );
}

export function ProgressRing({
  value,
  label,
  size = 92,
  tone = "#4f46e5",
}: {
  value: number;
  label?: string;
  size?: number;
  tone?: string;
}) {
  const style = {
    width: size,
    height: size,
    background: `conic-gradient(${tone} ${value * 3.6}deg,#edf0f5 0)`,
  } as CSSProperties;
  return (
    <div className="relative grid shrink-0 place-items-center rounded-full" style={style}>
      <div className="absolute rounded-full bg-white" style={{ width: size - 12, height: size - 12 }} />
      <div className="relative text-center">
        <div className="text-[22px] font-semibold tracking-tight text-slate-950">{value}</div>
        {label ? <div className="mt-[-2px] text-[9px] font-medium text-slate-500">{label}</div> : null}
      </div>
    </div>
  );
}

export function TinyTrend({ up = true }: { up?: boolean }) {
  return <span className={`text-[10px] font-semibold ${up ? "text-emerald-600" : "text-rose-500"}`}>{up ? "↗" : "↘"}</span>;
}

export function ToolbarButton({
  children,
  primary = false,
  icon,
  href,
  disabled = false,
  title,
}: {
  children: ReactNode;
  primary?: boolean;
  icon?: IconName;
  href?: string;
  disabled?: boolean;
  title?: string;
}) {
  const className = `inline-flex h-10 items-center gap-2 rounded-[10px] px-3.5 text-[11px] font-semibold transition ${
    disabled
      ? "cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400"
      : primary
        ? "bg-indigo-600 text-white shadow-sm hover:bg-indigo-700"
        : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
  }`;
  const content = (
    <>
      {icon ? <Icon name={icon} size={15} /> : null}
      {children}
    </>
  );

  if (href && !disabled) {
    return <Link href={href} className={className} title={title}>{content}</Link>;
  }

  return (
    <button type="button" disabled={disabled} className={className} title={title}>
      {content}
    </button>
  );
}

export function WorkspaceTabs({ tabs, active }: { tabs: Array<[string, string]>; active: string }) {
  return (
    <nav className="flex gap-7 overflow-x-auto border-b border-slate-200 text-[12px] text-slate-500">
      {tabs.map(([label, href]) => (
        <Link
          key={href}
          href={href}
          className={`relative whitespace-nowrap pb-3 pt-1 font-medium transition ${
            label === active ? "text-indigo-600" : "hover:text-slate-800"
          }`}
        >
          {label}
          {label === active ? <span className="absolute inset-x-0 bottom-0 h-[2px] bg-indigo-600" /> : null}
        </Link>
      ))}
    </nav>
  );
}

export function SkillChip({ children, verified = false }: { children: ReactNode; verified?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold ${
        verified ? "bg-emerald-50 text-emerald-700" : "bg-indigo-50 text-indigo-700"
      }`}
    >
      {verified ? <Icon name="check" size={10} /> : null}
      {children}
    </span>
  );
}

export function ScoreBar({
  label,
  value,
  tone = "emerald",
}: {
  label: string;
  value: number;
  tone?: "emerald" | "indigo" | "amber";
}) {
  const bar = tone === "indigo" ? "bg-indigo-500" : tone === "amber" ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="grid grid-cols-[120px_1fr_32px] items-center gap-3 text-[11px]">
      <span className="text-slate-600">{label}</span>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${value}%` }} />
      </div>
      <span className="text-right font-semibold text-slate-700">{value}</span>
    </div>
  );
}

export function EmptyChart({ label = "trend" }: { label?: string }) {
  return (
    <svg viewBox="0 0 120 34" className="h-8 w-28" aria-label={label}>
      <path d="M2 26 C20 25, 24 18, 38 20 S58 8,72 14 S94 6,118 8" fill="none" stroke="#6366f1" strokeWidth="2" />
      <path d="M2 32 C20 29,24 22,38 24 S58 12,72 18 S94 10,118 12" fill="none" stroke="#c7d2fe" strokeWidth="1.5" />
    </svg>
  );
}

export function DemoNotice() {
  return (
    <div className="inline-flex max-w-max items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-2.5 py-1 text-[9px] font-medium text-slate-500 shadow-sm">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
      Development dataset · not production metrics
    </div>
  );
}

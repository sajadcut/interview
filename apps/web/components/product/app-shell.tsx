"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { directionFor, getDefaultLocale, shellCopy } from "../../lib/i18n";
import { Icon, type IconName } from "./icon";

const iconByHref: Record<string, IconName> = {
  "/app": "home",
  "/app/jobs": "jobs",
  "/app/candidates": "candidates",
  "/app/talent": "talent",
  "/app/interviews": "interviews",
  "/app/inbox": "inbox",
  "/app/analytics": "analytics",
  "/app/automations": "automation",
  "/app/integrations": "integrations",
  "/app/settings": "settings",
};

function isActivePath(pathname: string, href: string): boolean {
  if (href === "/app") return pathname === "/app";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavItem({
  label,
  href,
  count,
  active,
}: {
  label: string;
  href: string;
  count?: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`group relative flex h-10 items-center gap-3 rounded-[10px] px-3 text-[12px] font-medium transition ${
        active
          ? "bg-white/[.09] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,.045)]"
          : "text-slate-300 hover:bg-white/[.055] hover:text-white"
      }`}
    >
      {active ? <span className="absolute inset-y-2 start-0 w-[3px] rounded-full bg-indigo-400" /> : null}
      <Icon name={iconByHref[href] ?? "home"} size={16} />
      <span className="flex-1">{label}</span>
      {count ? (
        <span className="rounded-full bg-indigo-500/25 px-2 py-0.5 text-[10px] font-semibold text-indigo-100">
          {count}
        </span>
      ) : null}
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const locale = getDefaultLocale();
  const copy = shellCopy[locale];
  const header =
    locale === "fa"
      ? {
          search: "جستجوی کاندیدا، موقعیت یا مصاحبه...",
          ask: "از AI بپرس",
          create: "ایجاد موقعیت",
          automation: "اتوماسیون",
          recruiter: "استخدام‌کننده",
        }
      : {
          search: "Search candidates, jobs, interviews...",
          ask: "Ask AI",
          create: "Create Job",
          automation: "Automation",
          recruiter: "Recruiter",
        };
  const primary = copy.navigation.slice(0, 7);
  const secondary = copy.navigation.slice(7);

  return (
    <div
      className="min-h-screen bg-[#f5f7fb] text-slate-900 lg:grid lg:grid-cols-[236px_minmax(0,1fr)]"
      dir={directionFor(locale)}
    >
      <aside className="hidden min-h-screen bg-[#0d1728] px-3.5 py-4 text-white lg:sticky lg:top-0 lg:block lg:h-screen">
        <div className="mb-6 flex items-center gap-3 px-2 py-1">
          <div className="grid h-9 w-9 place-items-center rounded-[11px] bg-gradient-to-br from-indigo-500 to-violet-500 shadow-lg shadow-indigo-950/30">
            <Icon name="sparkles" size={17} />
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold tracking-tight">AI Recruiter</div>
            <div className="mt-0.5 text-[10px] text-slate-400">{copy.subtitle}</div>
          </div>
        </div>

        <nav className="space-y-1" aria-label={copy.navigationLabel}>
          {primary.map(([label, href]) => {
            const count = href === "/app/inbox" ? "8" : undefined;
            return (
              <NavItem
                key={href}
                label={label}
                href={href}
                active={isActivePath(pathname, href)}
                {...(count ? { count } : {})}
              />
            );
          })}
        </nav>

        <div className="my-4 border-t border-white/10" />
        <div className="mb-2 px-3 text-[9px] font-semibold uppercase tracking-[.18em] text-slate-500">
          {header.automation}
        </div>
        <nav className="space-y-1">
          {secondary.map(([label, href]) => (
            <NavItem key={href} label={label} href={href} active={isActivePath(pathname, href)} />
          ))}
        </nav>

        <div className="absolute inset-x-3.5 bottom-4 flex items-center gap-3 rounded-[11px] border border-white/10 bg-white/[.045] p-3">
          <div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-amber-100 to-violet-200 text-[10px] font-bold text-slate-800">
            SN
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11px] font-semibold">Sara Noroozi</div>
            <div className="mt-0.5 text-[9px] text-slate-400">{header.recruiter}</div>
          </div>
          <Icon name="chevron" size={13} />
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-slate-200/90 bg-white/95 px-4 backdrop-blur sm:px-6">
          <div className="flex min-w-0 flex-1 items-center">
            <div className="relative hidden w-full max-w-[560px] md:block">
              <Icon
                name="search"
                size={15}
                className="absolute start-3.5 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                className="h-10 w-full rounded-[10px] border border-slate-200 bg-slate-50 ps-10 pe-3 text-[12px] text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:bg-white focus:ring-4 focus:ring-indigo-50"
                placeholder={header.search}
              />
            </div>
          </div>
          <button className="hidden h-10 items-center gap-2 rounded-[10px] border border-indigo-100 bg-indigo-50 px-3.5 text-[11px] font-semibold text-indigo-700 transition hover:bg-indigo-100 sm:inline-flex">
            <Icon name="sparkles" size={14} />
            {header.ask}
          </button>
          <Link
            href="/app/jobs/new"
            className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-indigo-600 px-3.5 text-[11px] font-semibold text-white shadow-sm transition hover:bg-indigo-700"
          >
            <Icon name="plus" size={14} />
            {header.create}
          </Link>
          <button className="relative grid h-10 w-10 place-items-center rounded-[10px] border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50">
            <Icon name="bell" size={15} />
            <span className="absolute end-1.5 top-1.5 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-white" />
          </button>
          <div className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-amber-100 to-violet-200 text-[10px] font-bold">
            SN
          </div>
        </header>

        <main className="mx-auto max-w-[1560px] p-4 sm:p-5 lg:p-6 xl:p-7" dir="ltr">
          {children}
        </main>
      </div>
    </div>
  );
}

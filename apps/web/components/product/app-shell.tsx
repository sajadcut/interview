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
      className={`group relative flex h-[38px] items-center gap-3 rounded-[10px] px-3 text-[12px] font-medium transition ${
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

function MobileNavItem({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-[9px] px-3 text-[11px] font-semibold transition ${
        active
          ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100"
          : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
      }`}
    >
      <Icon name={iconByHref[href] ?? "home"} size={14} />
      <span>{label}</span>
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
          searchPending: "جستجوی سراسری هنوز به ایندکس دامنه متصل نشده است",
          aiPending: "دستیار سراسری AI هنوز به این کنترل متصل نشده است",
          notificationsPending: "مرکز اعلان‌ها هنوز متصل نشده است",
        }
      : {
          search: "Search candidates, jobs, interviews...",
          ask: "Ask AI",
          create: "Create Job",
          automation: "Automation",
          recruiter: "Recruiter",
          searchPending: "Global search is not connected to the domain index yet",
          aiPending: "The global AI assistant is not wired to this control yet",
          notificationsPending: "Notification center is not wired yet",
        };
  const primary = copy.navigation.slice(0, 7);
  const secondary = copy.navigation.slice(7);

  return (
    <div
      className="min-h-screen bg-[#f5f7fb] text-slate-900 lg:grid lg:grid-cols-[236px_minmax(0,1fr)]"
      dir={directionFor(locale)}
    >
      <aside className="hidden bg-[#0d1728] px-3.5 py-4 text-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:min-h-0 lg:flex-col">
        <div className="mb-5 flex shrink-0 items-center gap-3 px-2 py-1">
          <div className="grid h-9 w-9 place-items-center rounded-[11px] bg-gradient-to-br from-indigo-500 to-violet-500 shadow-lg shadow-indigo-950/30">
            <Icon name="sparkles" size={17} />
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold tracking-tight">AI Recruiter</div>
            <div className="mt-0.5 text-[10px] text-slate-400">{copy.subtitle}</div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pe-1">
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
          <nav className="space-y-1" aria-label={`${copy.navigationLabel} · ${header.automation}`}>
            {secondary.map(([label, href]) => (
              <NavItem key={href} label={label} href={href} active={isActivePath(pathname, href)} />
            ))}
          </nav>
        </div>

        <div className="mt-3 flex shrink-0 items-center gap-3 rounded-[11px] border border-white/10 bg-white/[.045] p-3 shadow-[0_8px_28px_rgba(2,6,23,.18)]">
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
        <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-slate-200/90 bg-white/95 px-3 backdrop-blur sm:gap-3 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center">
            <div className="relative hidden w-full max-w-[560px] md:block" title={header.searchPending}>
              <Icon
                name="search"
                size={15}
                className="absolute start-3.5 top-1/2 -translate-y-1/2 text-slate-300"
              />
              <input
                readOnly
                aria-disabled="true"
                className="h-10 w-full cursor-not-allowed rounded-[10px] border border-slate-200 bg-slate-50 ps-10 pe-3 text-[12px] text-slate-400 outline-none placeholder:text-slate-400"
                placeholder={header.search}
              />
            </div>
          </div>
          <button type="button" disabled title={header.aiPending} className="hidden h-10 cursor-not-allowed items-center gap-2 rounded-[10px] border border-slate-200 bg-slate-100 px-3.5 text-[11px] font-semibold text-slate-400 sm:inline-flex">
            <Icon name="sparkles" size={14} />
            {header.ask}
          </button>
          <Link
            href="/app/jobs/new"
            aria-label={header.create}
            className="inline-flex h-10 min-w-10 items-center justify-center gap-2 rounded-[10px] bg-indigo-600 px-2.5 text-[11px] font-semibold text-white shadow-sm transition hover:bg-indigo-700 sm:px-3.5"
          >
            <Icon name="plus" size={14} />
            <span className="hidden sm:inline">{header.create}</span>
          </Link>
          <button type="button" disabled title={header.notificationsPending} className="relative grid h-10 w-10 shrink-0 cursor-not-allowed place-items-center rounded-[10px] border border-slate-200 bg-slate-100 text-slate-400">
            <Icon name="bell" size={15} />
          </button>
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-amber-100 to-violet-200 text-[10px] font-bold">
            SN
          </div>
        </header>

        <nav
          className="sticky top-16 z-20 flex gap-1 overflow-x-auto border-b border-slate-200 bg-white/95 px-3 py-2 backdrop-blur lg:hidden"
          aria-label={copy.mobileNavigationLabel}
        >
          {copy.navigation.map(([label, href]) => (
            <MobileNavItem key={href} label={label} href={href} active={isActivePath(pathname, href)} />
          ))}
        </nav>

        <main className="mx-auto max-w-[1560px] p-4 sm:p-5 lg:p-6 xl:p-7" dir="ltr">
          {children}
        </main>
      </div>
    </div>
  );
}

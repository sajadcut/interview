"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { api } from "../../lib/api";
import { directionFor, getDefaultLocale, shellCopy } from "../../lib/i18n";
import { clearRememberedOrganizationId } from "../../lib/tenant-client";
import { Icon, type IconName } from "./icon";
import { requiredPermissionForInternalPath, useInternalAccess } from "./internal-access";

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

function NavItem({ label, href, active }: { label: string; href: string; active: boolean }) {
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

function readableRole(role: string | undefined): string {
  if (!role) return "Member";
  if (role === "org_admin") return "Organization Admin";
  if (role === "HR_MANAGER") return "HR Manager";
  return role
    .split("_")
    .map((part) => `${part[0] ?? ""}${part.slice(1).toLowerCase()}`)
    .join(" ");
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const access = useInternalAccess();
  const locale = getDefaultLocale();
  const copy = shellCopy[locale];
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string>();
  const header = locale === "fa"
    ? {
        search: "جستجوی کاندیدا، موقعیت یا مصاحبه...",
        ask: "از AI بپرس",
        create: "ایجاد موقعیت",
        automation: "اتوماسیون",
        logout: "خروج امن",
        logoutFailed: "خروج امن انجام نشد. دوباره تلاش کنید.",
        aiPending: "دستیار سراسری AI هنوز به این کنترل متصل نشده است",
        notificationsPending: "مرکز اعلان‌ها هنوز متصل نشده است",
      }
    : {
        search: "Search candidates, jobs, interviews...",
        ask: "Ask AI",
        create: "Create Job",
        automation: "Automation",
        logout: "Sign out",
        logoutFailed: "Secure sign out failed. Please try again.",
        aiPending: "The global AI assistant is not wired to this control yet",
        notificationsPending: "Notification center is not wired yet",
      };

  const navigation = copy.navigation.filter(([, href]) => {
    if (href === "/app") return true;
    const permission = requiredPermissionForInternalPath(href);
    return permission ? access.can(permission) : true;
  });
  const secondaryHrefs = ["/app/automations", "/app/integrations", "/app/settings"];
  const primary = navigation.filter(([, href]) => !secondaryHrefs.includes(href));
  const secondary = navigation.filter(([, href]) => secondaryHrefs.includes(href));
  const displayName = access.user?.displayName || access.user?.email || "Organization member";
  const roleLabel = readableRole(access.roles[0]);
  const canCreateJob = access.can("job.create");

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    setLogoutError(undefined);
    try {
      const result = await api.POST("/auth/logout");
      if (!result.response.ok || result.error) throw new Error(header.logoutFailed);
      clearRememberedOrganizationId();
      window.location.replace("/login");
    } catch {
      setLogoutError(header.logoutFailed);
      setSigningOut(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f5f7fb] text-slate-900 lg:grid lg:grid-cols-[236px_minmax(0,1fr)]" dir={directionFor(locale)}>
      <aside className="hidden bg-[#0d1728] px-3.5 py-4 text-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:min-h-0 lg:flex-col">
        <div className="mb-5 flex shrink-0 items-center gap-3 px-2 py-1">
          <div className="grid h-9 w-9 place-items-center rounded-[11px] bg-gradient-to-br from-indigo-500 to-violet-500 shadow-lg shadow-indigo-950/30"><Icon name="sparkles" size={17} /></div>
          <div className="min-w-0"><div className="text-[13px] font-semibold tracking-tight">AI Recruiter</div><div className="mt-0.5 truncate text-[10px] text-slate-400">{access.organization?.name ?? copy.subtitle}</div></div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pe-1">
          <nav className="space-y-1" aria-label={copy.navigationLabel}>{primary.map(([label, href]) => <NavItem key={href} label={label} href={href} active={isActivePath(pathname, href)} />)}</nav>
          {secondary.length > 0 ? <><div className="my-4 border-t border-white/10" /><div className="mb-2 px-3 text-[9px] font-semibold uppercase tracking-[.18em] text-slate-500">{header.automation}</div><nav className="space-y-1" aria-label={`${copy.navigationLabel} · ${header.automation}`}>{secondary.map(([label, href]) => <NavItem key={href} label={label} href={href} active={isActivePath(pathname, href)} />)}</nav></> : null}
        </div>
        <div className="mt-3 rounded-[11px] border border-white/10 bg-white/[.045] p-3 shadow-[0_8px_28px_rgba(2,6,23,.18)]">
          {access.organizations.length > 1 ? <select aria-label="Organization" value={access.organization?.id} onChange={(event) => access.selectOrganization(event.target.value)} className="mb-3 w-full rounded-md border border-white/10 bg-slate-900 px-2 py-1.5 text-[10px] text-slate-200">{access.organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select> : null}
          <div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-amber-100 to-violet-200 text-[10px] font-bold text-slate-800">{displayName.slice(0, 2).toUpperCase()}</div><div className="min-w-0 flex-1"><div className="truncate text-[11px] font-semibold">{displayName}</div><div className="mt-0.5 truncate text-[9px] text-slate-400">{roleLabel}</div></div></div>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-slate-200/90 bg-white/95 px-3 backdrop-blur sm:gap-3 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center">
            <form action="/app/search" method="get" className="relative hidden w-full max-w-[560px] md:block">
              <Icon name="search" size={15} className="absolute start-3.5 top-1/2 -translate-y-1/2 text-slate-300" />
              <input name="q" minLength={2} className="h-10 w-full rounded-[10px] border border-slate-200 bg-slate-50 ps-10 pe-3 text-[12px] text-slate-700 outline-none placeholder:text-slate-400 focus:border-indigo-300 focus:bg-white" placeholder={header.search} />
            </form>
          </div>
          <button type="button" disabled title={header.aiPending} className="hidden h-10 cursor-not-allowed items-center gap-2 rounded-[10px] border border-slate-200 bg-slate-100 px-3.5 text-[11px] font-semibold text-slate-400 sm:inline-flex"><Icon name="sparkles" size={14} />{header.ask}</button>
          {canCreateJob ? <Link href="/app/jobs/new" aria-label={header.create} className="inline-flex h-10 min-w-10 items-center justify-center gap-2 rounded-[10px] bg-indigo-600 px-2.5 text-[11px] font-semibold text-white shadow-sm transition hover:bg-indigo-700 sm:px-3.5"><Icon name="plus" size={14} /><span className="hidden sm:inline">{header.create}</span></Link> : null}
          <button type="button" disabled title={header.notificationsPending} className="relative grid h-10 w-10 shrink-0 cursor-not-allowed place-items-center rounded-[10px] border border-slate-200 bg-slate-100 text-slate-400"><Icon name="bell" size={15} /></button>
          <div className="hidden min-w-0 text-end sm:block"><div className="max-w-36 truncate text-[10px] font-semibold text-slate-700">{displayName}</div><div className="max-w-36 truncate text-[9px] text-slate-400">{roleLabel}</div></div>
          <button
            type="button"
            aria-label={header.logout}
            disabled={signingOut}
            onClick={() => void signOut()}
            className="inline-flex h-10 min-w-10 shrink-0 items-center justify-center gap-1.5 rounded-[10px] border border-slate-200 bg-white px-2.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60 sm:px-3"
          >
            <span aria-hidden="true">↪</span><span className="hidden sm:inline">{signingOut ? "…" : header.logout}</span>
          </button>
        </header>
        {logoutError ? <div role="alert" className="border-b border-rose-100 bg-rose-50 px-4 py-2 text-xs text-rose-700 sm:px-6">{logoutError}</div> : null}
        <nav className="sticky top-16 z-20 flex gap-1 overflow-x-auto border-b border-slate-200 bg-white/95 px-3 py-2 backdrop-blur lg:hidden" aria-label={copy.mobileNavigationLabel}>{navigation.map(([label, href]) => <MobileNavItem key={href} label={label} href={href} active={isActivePath(pathname, href)} />)}</nav>
        <main className="mx-auto max-w-[1560px] p-4 sm:p-5 lg:p-6 xl:p-7" dir="ltr">{children}</main>
      </div>
    </div>
  );
}

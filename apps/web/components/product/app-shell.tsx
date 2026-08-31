import Link from "next/link";
import type { ReactNode } from "react";
import { getDefaultLocale, shellCopy } from "../../lib/i18n";

export function AppShell({ children }: { children: ReactNode }) {
  const copy = shellCopy[getDefaultLocale()];
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <aside className="hidden border-e border-[var(--border)] bg-[var(--surface)] p-4 lg:block">
        <div className="px-3 py-4">
          <div className="text-sm font-bold">Interview Platform</div>
          <div className="mt-1 text-xs text-[var(--muted)]">{copy.subtitle}</div>
        </div>
        <nav className="mt-4 space-y-1" aria-label={copy.navigationLabel}>
          {copy.navigation.map(([label, href]) => (
            <Link key={href} href={href} className="block rounded-lg px-3 py-2.5 text-sm font-medium hover:bg-[var(--surface-subtle)]">
              {label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="min-w-0">
        <div className="border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3 lg:hidden">
          <div className="mb-3 text-sm font-bold">Interview Platform</div>
          <nav className="flex gap-2 overflow-x-auto pb-1" aria-label={copy.mobileNavigationLabel}>
            {copy.navigation.slice(0, 6).map(([label, href]) => (
              <Link key={href} href={href} className="whitespace-nowrap rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold">
                {label}
              </Link>
            ))}
          </nav>
        </div>
        <main className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}

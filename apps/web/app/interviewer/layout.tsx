import Link from "next/link";
import type { ReactNode } from "react";
import { directionFor, getInternalLocale } from "../../lib/i18n";

export default function InterviewerLayout({ children }: { children: ReactNode }) {
  const locale = getInternalLocale();
  return (
    <div className="persian-ui min-h-screen bg-slate-50" dir={directionFor(locale)}>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[.16em] text-indigo-600">سامانه جذب و استخدام هوشمند</div>
            <div className="text-sm font-semibold text-slate-950">فضای کاری مصاحبه‌گر</div>
          </div>
          <nav className="flex w-full flex-wrap items-center gap-2 text-xs font-semibold text-slate-600 sm:w-auto">
            <Link className="rounded-lg px-3 py-2 hover:bg-slate-100" href="/interviewer">امروز</Link>
            <Link className="rounded-lg px-3 py-2 hover:bg-slate-100" href="/interviewer/interviews">مصاحبه‌های من</Link>
            <Link className="rounded-lg px-3 py-2 hover:bg-slate-100" href="/interviewer/scorecard">امتیازنامه‌ها</Link>
            <Link className="rounded-lg px-3 py-2 hover:bg-slate-100" href="/app">پنل اصلی</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}

import type { ReactNode } from "react";
import { directionFor, foundationCopy, getDefaultLocale } from "../../lib/i18n";

export default function CandidateLayout({ children }: { children: ReactNode }) {
  const locale = getDefaultLocale();
  const copy = foundationCopy[locale];
  return (
    <div lang={locale} dir={directionFor(locale)} className="min-h-screen bg-slate-50">
      <div className="sr-only">{copy.candidateBrand}</div>
      {children}
    </div>
  );
}

import type { ReactNode } from "react";
import { foundationCopy, getDefaultLocale } from "../../lib/i18n";

export default function CandidateLayout({ children }: { children: ReactNode }) {
  const copy = foundationCopy[getDefaultLocale()];
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="sr-only">{copy.candidateBrand}</div>
      {children}
    </div>
  );
}

import type { ReactNode } from "react";
import { foundationCopy, getDefaultLocale } from "../../lib/i18n";

export default function CandidateLayout({ children }: { children: ReactNode }) {
  const copy = foundationCopy[getDefaultLocale()];
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-6">
      <div className="mb-8 text-sm font-bold">{copy.candidateBrand}</div>
      {children}
    </main>
  );
}

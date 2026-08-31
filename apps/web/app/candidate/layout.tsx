import type { ReactNode } from "react";

export default function CandidateLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-6">
      <div className="mb-8 text-sm font-bold">Interview Platform · Candidate</div>
      {children}
    </main>
  );
}

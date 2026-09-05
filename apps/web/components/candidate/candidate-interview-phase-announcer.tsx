"use client";

import type { ReactNode } from "react";

export function CandidateInterviewPhaseAnnouncer({ children }: { children: ReactNode }) {
  return <div aria-live="polite">{children}</div>;
}

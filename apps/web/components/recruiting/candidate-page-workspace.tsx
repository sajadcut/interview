"use client";

import { useState } from "react";
import { CandidateIntelligenceWorkspace } from "./candidate-intelligence-workspace";
import { ResumeIngestionPanel } from "./resume-ingestion-panel";

export function CandidatePageWorkspace({ candidateId }: { candidateId: string }) {
  const [revision, setRevision] = useState(0);

  return (
    <div className="space-y-5">
      <ResumeIngestionPanel
        candidateId={candidateId}
        onIngested={() => setRevision((current) => current + 1)}
      />
      <CandidateIntelligenceWorkspace key={revision} candidateId={candidateId} />
    </div>
  );
}

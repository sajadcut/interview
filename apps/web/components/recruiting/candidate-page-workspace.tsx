"use client";

import { useState } from "react";
import { CandidateIntelligenceWorkspace } from "./candidate-intelligence-workspace";
import { CandidateSkillProposalsPanel } from "./candidate-skill-proposals-panel";
import { ResumeIngestionPanel } from "./resume-ingestion-panel";

export function CandidatePageWorkspace({ candidateId }: { candidateId: string }) {
  const [revision, setRevision] = useState(0);

  return (
    <div className="space-y-5">
      <ResumeIngestionPanel
        candidateId={candidateId}
        onIngested={() => setRevision((current) => current + 1)}
      />
      <CandidateSkillProposalsPanel key={revision} candidateId={candidateId} />
      <CandidateIntelligenceWorkspace key={revision} candidateId={candidateId} />
    </div>
  );
}

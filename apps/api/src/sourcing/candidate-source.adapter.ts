export const ApprovedSourceTypes = {
  InternalTalentPool: "internal_talent_pool",
  Ats: "ats",
  ApprovedJobBoard: "approved_job_board",
  ApprovedExternal: "approved_external",
} as const;

export type ApprovedSourceType = (typeof ApprovedSourceTypes)[keyof typeof ApprovedSourceTypes];

export interface CandidateSourceSearchRequest {
  organizationId: string;
  jobId: string;
  query: string;
  limit: number;
  idempotencyKey?: string;
}

export interface CandidateSourceProvenance {
  providerKey: string;
  sourceType: ApprovedSourceType;
  observedAt: string;
  retrievedAt: string;
  externalKey?: string;
  sourceUrl?: string;
  evidenceReferences: string[];
}

export interface CandidateSourceResult {
  sourceType: ApprovedSourceType;
  sourceExternalKey?: string;
  candidateId?: string;
  displayName: string;
  currentRole?: string;
  currentCompany?: string;
  skills: string[];
  retrievalScore: number;
  evidenceSummary: string[];
  normalizedIdentity?: {
    email?: string;
    phone?: string;
  };
  provenance: CandidateSourceProvenance;
}

export interface CandidateSourceAdapter {
  readonly sourceType: ApprovedSourceType;
  readonly providerKey: string;
  readonly requiresApproval: boolean;
  search(request: CandidateSourceSearchRequest): Promise<CandidateSourceResult[]>;
}

export interface AtsCandidateSourceAdapter extends CandidateSourceAdapter {
  readonly sourceType: typeof ApprovedSourceTypes.Ats;
  readonly requiresApproval: true;
}

export interface JobBoardCandidateSourceAdapter extends CandidateSourceAdapter {
  readonly sourceType: typeof ApprovedSourceTypes.ApprovedJobBoard;
  readonly requiresApproval: true;
}

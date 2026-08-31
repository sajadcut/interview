export interface CandidateSourceSearchRequest {
  organizationId: string;
  jobId: string;
  query: string;
  limit: number;
}

export interface CandidateSourceResult {
  sourceType: string;
  sourceExternalKey?: string;
  candidateId?: string;
  displayName: string;
  currentRole?: string;
  currentCompany?: string;
  skills: string[];
  retrievalScore: number;
  evidenceSummary: string[];
}

export interface CandidateSourceAdapter {
  readonly sourceType: string;
  readonly requiresApproval: boolean;
  search(request: CandidateSourceSearchRequest): Promise<CandidateSourceResult[]>;
}

export const ApprovedSourceTypes = {
  InternalTalentPool: "internal_talent_pool",
  Ats: "ats",
  ApprovedJobBoard: "approved_job_board",
  ApprovedExternal: "approved_external",
} as const;

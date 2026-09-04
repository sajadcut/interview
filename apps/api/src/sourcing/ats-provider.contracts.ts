import type { AtsCandidateSourceAdapter } from "./candidate-source.adapter";

export type AtsProviderKey = "greenhouse" | "lever";

export interface AtsConnection {
  id: string;
  organizationId: string;
  providerKey: AtsProviderKey;
  credentialReference: string;
  config: Record<string, unknown>;
  status: string;
}

export interface AtsJob {
  provider: AtsProviderKey;
  externalId: string;
  title: string;
  status: string;
  location?: string;
  department?: string;
  sourceUrl?: string;
}

export interface AtsExportCandidate {
  applicationId: string;
  candidateId: string;
  jobId: string;
  displayName: string;
  primaryEmail?: string;
  primaryPhone?: string;
  currentCompany?: string;
  currentRole?: string;
  providerJobReference: string;
  idempotencyKey: string;
}

export interface AtsExportResult {
  provider: AtsProviderKey;
  providerCandidateReference: string;
  providerApplicationReference: string;
  providerJobReference: string;
  deduplicated: boolean;
}

export interface AtsStageUpdate {
  providerApplicationReference: string;
  currentStageReference?: string;
  targetStageReference: string;
  idempotencyKey: string;
}

export interface AtsProvider extends AtsCandidateSourceAdapter {
  readonly providerKey: AtsProviderKey;
  isConfiguredFor(organizationId: string): Promise<boolean>;
  verify(organizationId: string): Promise<{ provider: AtsProviderKey; ready: true }>;
  listJobs(organizationId: string, limit: number): Promise<AtsJob[]>;
  exportApplication(organizationId: string, input: AtsExportCandidate): Promise<AtsExportResult>;
  updateStage(organizationId: string, input: AtsStageUpdate): Promise<void>;
}

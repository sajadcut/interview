export interface EnterpriseUserRecord {
  id: string;
  organizationId: string;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CredentialRecord {
  id: string;
  userId: string;
  passwordHash: string;
  failedLoginCount: number;
  lockedUntil?: Date | null;
  passwordUpdatedAt: Date;
}

export interface SessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt?: Date | null;
}

export interface CandidateIdentityRecord {
  id: string;
  candidateId: string;
  invitationTokenHash: string;
  verifiedAt?: Date | null;
  expiresAt: Date;
}

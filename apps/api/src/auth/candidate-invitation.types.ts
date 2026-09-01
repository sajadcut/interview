export type CandidateInvitationStatus =
  | 'PENDING'
  | 'VERIFIED'
  | 'EXPIRED'
  | 'CONSUMED'
  | 'REVOKED';

export interface CandidateInvitationToken {
  id: string;
  candidateId: string;
  organizationId: string;
  tokenHash: string;
  status: CandidateInvitationStatus;
  expiresAt: Date;
}

export interface CandidateIdentitySetup {
  invitationId: string;
  otpVerified: boolean;
  magicLinkVerified: boolean;
}

export type CandidateIdentityStatus =
  | 'INVITED'
  | 'VERIFIED'
  | 'ACTIVE'
  | 'EXPIRED';

export interface CandidateIdentityContext {
  candidateId: string;
  invitationId?: string;
  status: CandidateIdentityStatus;
}

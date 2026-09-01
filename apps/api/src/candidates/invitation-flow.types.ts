export type CandidateInvitationStep =
  | 'CREATED'
  | 'SENT'
  | 'VALIDATED'
  | 'VERIFIED'
  | 'COMPLETED';

export interface CandidateInvitationContext {
  tokenId: string;
  candidateId: string;
  step: CandidateInvitationStep;
}

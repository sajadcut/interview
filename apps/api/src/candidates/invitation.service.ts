export type CandidateInvitationStatus =
  | 'CREATED'
  | 'SENT'
  | 'VERIFIED'
  | 'EXPIRED';

export class CandidateInvitationService {
  createInvitation(candidateEmail: string) {
    return {
      candidateEmail,
      status: 'CREATED' as CandidateInvitationStatus,
      tokenStorage: 'hashed-only',
    };
  }
}

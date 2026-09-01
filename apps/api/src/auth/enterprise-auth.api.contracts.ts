export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  userId: string;
  sessionId: string;
  expiresAt: string;
}

export interface CandidateInvitationRequest {
  candidateId: string;
  email: string;
}

export interface CandidateVerificationRequest {
  token: string;
  otp?: string;
}

export interface SessionRevokeRequest {
  sessionId: string;
}

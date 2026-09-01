export enum InternalRole {
  PLATFORM_ADMIN = 'PLATFORM_ADMIN',
  ORGANIZATION_ADMIN = 'ORGANIZATION_ADMIN',
  RECRUITER = 'RECRUITER',
  INTERVIEWER = 'INTERVIEWER',
  HIRING_MANAGER = 'HIRING_MANAGER',
}

export enum CandidateAuthType {
  INVITATION = 'INVITATION',
  MAGIC_LINK = 'MAGIC_LINK',
  OTP = 'OTP',
}

export enum SessionStatus {
  ACTIVE = 'ACTIVE',
  REVOKED = 'REVOKED',
  EXPIRED = 'EXPIRED',
}

export const AUTH_COOKIE = 'interview_session';
export const REFRESH_COOKIE = 'interview_refresh';

export const ACCOUNT_SECURITY_POLICY = {
  maxFailedAttempts: 5,
  lockMinutes: 30,
  sessionDays: 7,
} as const;

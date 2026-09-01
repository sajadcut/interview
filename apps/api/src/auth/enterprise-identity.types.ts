export const INTERNAL_ROLES = [
  'PLATFORM_ADMIN',
  'ORGANIZATION_ADMIN',
  'RECRUITER',
  'INTERVIEWER',
  'HIRING_MANAGER',
] as const;

export type InternalRole = (typeof INTERNAL_ROLES)[number];

export const CANDIDATE_ROLE = 'CANDIDATE' as const;

export type AccountType = 'INTERNAL_USER' | 'CANDIDATE';

export interface AuthenticatedIdentity {
  id: string;
  accountType: AccountType;
  organizationId?: string;
  role?: InternalRole | typeof CANDIDATE_ROLE;
  sessionId: string;
}

export interface SessionPolicy {
  ttlSeconds: number;
  refreshTtlSeconds: number;
  httpOnly: boolean;
  secure: boolean;
}

export const DEFAULT_SESSION_POLICY: SessionPolicy = {
  ttlSeconds: 3600,
  refreshTtlSeconds: 2592000,
  httpOnly: true,
  secure: true,
};

export type OrganizationRole =
  | 'ORGANIZATION_ADMIN'
  | 'RECRUITER'
  | 'INTERVIEWER'
  | 'HIRING_MANAGER';

export type PlatformRole = 'PLATFORM_ADMIN';

export interface MembershipScope {
  organizationId: string;
  userId: string;
  role: OrganizationRole;
}

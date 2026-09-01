export type OrganizationRole =
  | 'PLATFORM_ADMIN'
  | 'ORGANIZATION_ADMIN'
  | 'RECRUITER'
  | 'INTERVIEWER'
  | 'HIRING_MANAGER';

export interface MembershipScope {
  organizationId: string;
  userId: string;
  role: OrganizationRole;
}

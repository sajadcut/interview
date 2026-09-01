export const PLATFORM_ROLES = {
  PLATFORM_ADMIN: 'PLATFORM_ADMIN',
  ORGANIZATION_ADMIN: 'ORGANIZATION_ADMIN',
  RECRUITER: 'RECRUITER',
  INTERVIEWER: 'INTERVIEWER',
  HIRING_MANAGER: 'HIRING_MANAGER',
  CANDIDATE: 'CANDIDATE',
} as const;

export type PlatformRole =
  (typeof PLATFORM_ROLES)[keyof typeof PLATFORM_ROLES];

export const ROLE_PERMISSIONS: Record<PlatformRole, string[]> = {
  PLATFORM_ADMIN: ['*'],
  ORGANIZATION_ADMIN: [
    'organization.manage',
    'members.manage',
    'settings.manage',
    'audit.read',
  ],
  RECRUITER: [
    'jobs.manage',
    'candidates.read',
    'applications.manage',
    'interviews.manage',
    'outreach.manage',
  ],
  INTERVIEWER: [
    'interviews.read.assigned',
    'scorecards.submit',
    'evidence.review',
  ],
  HIRING_MANAGER: [
    'jobs.read.assigned',
    'candidates.review',
    'shortlists.review',
  ],
  CANDIDATE: [
    'profile.read.self',
    'screening.execute.self',
    'interview.execute.self',
  ],
};

export function hasPermission(
  role: PlatformRole,
  permission: string,
): boolean {
  const permissions = ROLE_PERMISSIONS[role] ?? [];
  return permissions.includes('*') || permissions.includes(permission);
}

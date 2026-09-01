export const PERMISSIONS = [
  'jobs.create',
  'jobs.update',
  'jobs.delete',
  'jobs.view',
  'candidates.create',
  'candidates.view',
  'candidates.invite',
  'interviews.create',
  'interviews.start',
  'interviews.review',
  'scorecards.create',
  'scorecards.approve',
  'organization.manage_users',
  'settings.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

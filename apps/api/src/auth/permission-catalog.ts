export const PERMISSION_CATALOG = {
  jobs: ['jobs.create', 'jobs.update', 'jobs.delete', 'jobs.view'],
  candidates: ['candidates.create', 'candidates.view', 'candidates.invite'],
  interviews: ['interviews.create', 'interviews.start', 'interviews.review'],
  scorecards: ['scorecards.create', 'scorecards.approve'],
  organization: ['organization.manage_users'],
  settings: ['settings.manage'],
} as const;

export type Permission =
  (typeof PERMISSION_CATALOG)[keyof typeof PERMISSION_CATALOG][number];

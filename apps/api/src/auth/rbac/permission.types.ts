export type Permission =
  | 'organization.manage_users'
  | 'organization.manage_settings'
  | 'jobs.create'
  | 'jobs.update'
  | 'jobs.delete'
  | 'jobs.view'
  | 'candidates.create'
  | 'candidates.view'
  | 'candidates.invite'
  | 'interviews.create'
  | 'interviews.start'
  | 'interviews.review'
  | 'scorecards.create'
  | 'scorecards.approve';

export interface AuthorizationContext {
  userId: string;
  organizationId: string;
  role: string;
  permissions: Permission[];
}

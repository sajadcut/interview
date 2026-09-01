export const ENTERPRISE_PERMISSIONS = {
  jobsCreate: 'jobs.create',
  jobsUpdate: 'jobs.update',
  jobsDelete: 'jobs.delete',
  jobsView: 'jobs.view',
  candidatesCreate: 'candidates.create',
  candidatesView: 'candidates.view',
  candidatesInvite: 'candidates.invite',
  interviewsCreate: 'interviews.create',
  interviewsStart: 'interviews.start',
  interviewsReview: 'interviews.review',
  scorecardsCreate: 'scorecards.create',
  scorecardsApprove: 'scorecards.approve',
  organizationManageUsers: 'organization.manage_users',
  settingsManage: 'settings.manage',
} as const;

export type EnterprisePermission =
  (typeof ENTERPRISE_PERMISSIONS)[keyof typeof ENTERPRISE_PERMISSIONS];

export const ROLE_PERMISSIONS: Record<string, readonly EnterprisePermission[]> = {
  PLATFORM_ADMIN: Object.values(ENTERPRISE_PERMISSIONS),
  ORGANIZATION_ADMIN: [
    ENTERPRISE_PERMISSIONS.organizationManageUsers,
    ENTERPRISE_PERMISSIONS.settingsManage,
    ENTERPRISE_PERMISSIONS.jobsView,
    ENTERPRISE_PERMISSIONS.candidatesView,
    ENTERPRISE_PERMISSIONS.interviewsReview,
  ],
  RECRUITER: [
    ENTERPRISE_PERMISSIONS.jobsCreate,
    ENTERPRISE_PERMISSIONS.jobsUpdate,
    ENTERPRISE_PERMISSIONS.jobsView,
    ENTERPRISE_PERMISSIONS.candidatesCreate,
    ENTERPRISE_PERMISSIONS.candidatesView,
    ENTERPRISE_PERMISSIONS.candidatesInvite,
  ],
  INTERVIEWER: [
    ENTERPRISE_PERMISSIONS.interviewsStart,
    ENTERPRISE_PERMISSIONS.interviewsReview,
    ENTERPRISE_PERMISSIONS.scorecardsCreate,
  ],
  HIRING_MANAGER: [
    ENTERPRISE_PERMISSIONS.candidatesView,
    ENTERPRISE_PERMISSIONS.interviewsReview,
    ENTERPRISE_PERMISSIONS.scorecardsApprove,
  ],
  CANDIDATE: [],
};

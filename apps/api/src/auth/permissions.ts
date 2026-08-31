export const Permissions = {
  OrganizationRead: "organization.read",
  OrganizationManage: "organization.manage",
  JobRead: "job.read",
  JobCreate: "job.create",
  JobEdit: "job.edit",
  CandidateRead: "candidate.read",
  CandidateContact: "candidate.contact",
  CandidateMoveStage: "candidate.move_stage",
  CandidateScore: "candidate.score",
  InterviewRead: "interview.read",
  InterviewManage: "interview.manage",
  DecisionSubmit: "decision.submit",
  IntegrationManage: "integration.manage",
  AuditRead: "audit.read",
} as const;

export type Permission = (typeof Permissions)[keyof typeof Permissions];

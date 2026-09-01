import { Permissions, type Permission } from "../auth/permissions";
import type { OrganizationRole } from "./membership-role.types";

export const ORGANIZATION_ROLES: readonly OrganizationRole[] = [
  "ORGANIZATION_ADMIN",
  "HR_MANAGER",
  "RECRUITER",
  "INTERVIEWER",
  "HIRING_MANAGER",
] as const;

const ALL_PERMISSIONS = Object.values(Permissions);

export const ORGANIZATION_ROLE_PERMISSIONS: Record<OrganizationRole, readonly Permission[]> = {
  ORGANIZATION_ADMIN: ALL_PERMISSIONS,
  HR_MANAGER: [
    Permissions.OrganizationRead,
    Permissions.SettingsManage,
    Permissions.JobRead,
    Permissions.JobEdit,
    Permissions.CandidateRead,
    Permissions.CandidateContact,
    Permissions.CandidateMoveStage,
    Permissions.CandidateScore,
    Permissions.TalentManage,
    Permissions.ScreeningManage,
    Permissions.SchedulingManage,
    Permissions.KnowledgeManage,
    Permissions.InterviewRead,
    Permissions.InterviewAssign,
    Permissions.InterviewEvaluate,
    Permissions.AssessmentRead,
    Permissions.AnalyticsRead,
    Permissions.PrivacyManage,
    Permissions.DecisionSubmit,
    Permissions.AuditRead,
  ],
  RECRUITER: [
    Permissions.JobRead,
    Permissions.JobCreate,
    Permissions.JobEdit,
    Permissions.CandidateRead,
    Permissions.CandidateContact,
    Permissions.CandidateMoveStage,
    Permissions.CandidateScore,
    Permissions.SourcingRun,
    Permissions.TalentManage,
    Permissions.ScreeningManage,
    Permissions.SchedulingManage,
    Permissions.KnowledgeManage,
    Permissions.InterviewRead,
    Permissions.InterviewManage,
    Permissions.InterviewAssign,
    Permissions.InterviewStart,
    Permissions.AssessmentRead,
    Permissions.AssessmentManage,
  ],
  INTERVIEWER: [
    Permissions.CandidateRead,
    Permissions.CandidateScore,
    Permissions.InterviewRead,
    Permissions.InterviewStart,
    Permissions.InterviewEvaluate,
    Permissions.AssessmentRead,
  ],
  HIRING_MANAGER: [
    Permissions.OrganizationRead,
    Permissions.JobRead,
    Permissions.CandidateRead,
    Permissions.CandidateScore,
    Permissions.InterviewRead,
    Permissions.InterviewEvaluate,
    Permissions.AssessmentRead,
    Permissions.AnalyticsRead,
    Permissions.DecisionSubmit,
  ],
};

export function isOrganizationRole(value: string): value is OrganizationRole {
  return (ORGANIZATION_ROLES as readonly string[]).includes(value);
}

export function roleDisplayName(role: OrganizationRole): string {
  return role
    .split("_")
    .map((part) => `${part[0] ?? ""}${part.slice(1).toLowerCase()}`)
    .join(" ");
}

import assert from "node:assert/strict";
import test from "node:test";
import { Permissions } from "../auth/permissions";
import {
  isOrganizationRole,
  ORGANIZATION_ROLE_PERMISSIONS,
  roleDisplayName,
} from "./organization-role-policy";

test("organization role policy recognizes only tenant-scoped internal roles", () => {
  assert.equal(isOrganizationRole("ORGANIZATION_ADMIN"), true);
  assert.equal(isOrganizationRole("HR_MANAGER"), true);
  assert.equal(isOrganizationRole("INTERVIEWER"), true);
  assert.equal(isOrganizationRole("PLATFORM_ADMIN"), false);
  assert.equal(isOrganizationRole("CANDIDATE"), false);
  assert.equal(isOrganizationRole("unknown"), false);
});

test("organization admins can manage users while interviewers and HR managers cannot", () => {
  assert.equal(
    ORGANIZATION_ROLE_PERMISSIONS.ORGANIZATION_ADMIN.includes(Permissions.OrganizationManageUsers),
    true,
  );
  assert.equal(
    ORGANIZATION_ROLE_PERMISSIONS.INTERVIEWER.includes(Permissions.OrganizationManageUsers),
    false,
  );
  assert.equal(
    ORGANIZATION_ROLE_PERMISSIONS.HR_MANAGER.includes(Permissions.OrganizationManageUsers),
    false,
  );
});

test("HR managers can oversee policy, privacy, analytics and decisions without integration administration", () => {
  const permissions = ORGANIZATION_ROLE_PERMISSIONS.HR_MANAGER;
  assert.equal(permissions.includes(Permissions.SettingsManage), true);
  assert.equal(permissions.includes(Permissions.PrivacyManage), true);
  assert.equal(permissions.includes(Permissions.AnalyticsRead), true);
  assert.equal(permissions.includes(Permissions.DecisionSubmit), true);
  assert.equal(permissions.includes(Permissions.AuditRead), true);
  assert.equal(permissions.includes(Permissions.IntegrationManage), false);
  assert.equal(permissions.includes(Permissions.OrganizationManageUsers), false);
});

test("interviewers can start assigned interviews but cannot manage or assign sessions", () => {
  const permissions = ORGANIZATION_ROLE_PERMISSIONS.INTERVIEWER;
  assert.equal(permissions.includes(Permissions.InterviewStart), true);
  assert.equal(permissions.includes(Permissions.InterviewEvaluate), true);
  assert.equal(permissions.includes(Permissions.InterviewManage), false);
  assert.equal(permissions.includes(Permissions.InterviewAssign), false);
});

test("role display name is stable and human readable", () => {
  assert.equal(roleDisplayName("HIRING_MANAGER"), "Hiring Manager");
  assert.equal(roleDisplayName("HR_MANAGER"), "Hr Manager");
});

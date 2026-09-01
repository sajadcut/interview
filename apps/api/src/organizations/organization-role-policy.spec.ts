import assert from "node:assert/strict";
import test from "node:test";
import { Permissions } from "../auth/permissions";
import {
  isOrganizationRole,
  ORGANIZATION_ROLE_PERMISSIONS,
  roleDisplayName,
} from "./organization-role-policy";

test("organization role policy recognizes only supported internal roles", () => {
  assert.equal(isOrganizationRole("ORGANIZATION_ADMIN"), true);
  assert.equal(isOrganizationRole("INTERVIEWER"), true);
  assert.equal(isOrganizationRole("CANDIDATE"), false);
  assert.equal(isOrganizationRole("unknown"), false);
});

test("organization admins can manage users while interviewers cannot", () => {
  assert.equal(
    ORGANIZATION_ROLE_PERMISSIONS.ORGANIZATION_ADMIN.includes(Permissions.OrganizationManageUsers),
    true,
  );
  assert.equal(
    ORGANIZATION_ROLE_PERMISSIONS.INTERVIEWER.includes(Permissions.OrganizationManageUsers),
    false,
  );
});

test("role display name is stable and human readable", () => {
  assert.equal(roleDisplayName("HIRING_MANAGER"), "Hiring Manager");
});

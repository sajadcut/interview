import assert from "node:assert/strict";
import test from "node:test";
import { ForbiddenException, UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PermissionsGuard, shouldAuditPermissionGrant } from "./permissions.guard";
import { Permissions, type Permission } from "./permissions";
import type {
  PermissionAuditInput,
  PermissionAuditService,
} from "./security/permission-audit.service";
import type { TenantAccessService } from "./tenant-access.service";

class TestController {}
function testHandler() {}

const organizationId = "22222222-2222-4222-8222-222222222222";
const userId = "11111111-1111-4111-8111-111111111111";
const membershipId = "33333333-3333-4333-8333-333333333333";

function contextFor(method = "GET"): ExecutionContext {
  return {
    getHandler: () => testHandler,
    getClass: () => TestController,
    switchToHttp: () => ({
      getRequest: () => ({
        method,
        path: "/v1/jobs/123",
        originalUrl: "/v1/jobs/123?token=must-not-enter-audit",
        requestId: "request-1",
      }),
      getResponse: () => undefined,
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
}

function createGuard(
  granted: Permission[],
  required: Permission[] = [Permissions.JobRead],
  accessError?: Error,
) {
  const reflector = { getAllAndOverride: () => required } as unknown as Reflector;
  const tenantAccess = {
    requireCurrentAccess: async () => {
      if (accessError) throw accessError;
      return {
        organizationId,
        userId,
        membershipId,
        platformAdmin: false,
        permissions: new Set(granted),
      };
    },
  } as unknown as TenantAccessService;
  const denied: PermissionAuditInput[] = [];
  const grantedAudit: PermissionAuditInput[] = [];
  const permissionAudit = {
    recordDenied: async (input: PermissionAuditInput) => {
      denied.push(input);
    },
    recordGranted: async (input: PermissionAuditInput) => {
      grantedAudit.push(input);
    },
  } as unknown as PermissionAuditService;
  return {
    guard: new PermissionsGuard(reflector, tenantAccess, permissionAudit),
    denied,
    grantedAudit,
  };
}

test("permission guard allows a read and does not create noisy grant audit", async () => {
  const { guard, grantedAudit } = createGuard([Permissions.JobRead]);
  assert.equal(await guard.canActivate(contextFor("GET")), true);
  assert.equal(grantedAudit.length, 0);
});

test("permission guard audits successful state-changing permission decisions", async () => {
  const { guard, grantedAudit } = createGuard(
    [Permissions.JobEdit],
    [Permissions.JobEdit],
  );
  assert.equal(await guard.canActivate(contextFor("PATCH")), true);
  assert.equal(grantedAudit.length, 1);
  assert.deepEqual(grantedAudit[0]?.required, [Permissions.JobEdit]);
});

test("permission guard rejects and audits a missing database-derived permission", async () => {
  const { guard, denied } = createGuard([], [Permissions.JobRead]);
  await assert.rejects(() => guard.canActivate(contextFor()), ForbiddenException);
  assert.equal(denied.length, 1);
  assert.deepEqual(denied[0]?.missing, [Permissions.JobRead]);
  assert.equal(denied[0]?.reason, "missing_permissions");
});

test("permission guard audits access-resolution failures when actor context exists", async () => {
  const { guard, denied } = createGuard(
    [],
    [Permissions.JobRead],
    new UnauthorizedException("Authentication is required"),
  );
  await assert.rejects(() => guard.canActivate(contextFor()), UnauthorizedException);
  assert.equal(denied.length, 1);
  assert.equal(denied[0]?.reason, "access_resolution_failed");
});

test("high-risk reads and all state changes require grant audit", () => {
  assert.equal(shouldAuditPermissionGrant("GET", [Permissions.JobRead]), false);
  assert.equal(shouldAuditPermissionGrant("GET", [Permissions.AuditRead]), true);
  assert.equal(shouldAuditPermissionGrant("POST", [Permissions.CandidateContact]), true);
});

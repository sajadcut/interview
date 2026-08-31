import assert from "node:assert/strict";
import test from "node:test";
import { ForbiddenException, UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PermissionsGuard } from "./permissions.guard";
import { Permissions, type Permission } from "./permissions";
import type { TenantAccessService } from "./tenant-access.service";

class TestController {}
function testHandler() {}

const context = {
  getHandler: () => testHandler,
  getClass: () => TestController,
} as unknown as ExecutionContext;

const organizationId = "22222222-2222-4222-8222-222222222222";
const userId = "11111111-1111-4111-8111-111111111111";
const membershipId = "33333333-3333-4333-8333-333333333333";

function createGuard(granted: Permission[], required = [Permissions.JobRead]) {
  const reflector = { getAllAndOverride: () => required } as unknown as Reflector;
  const tenantAccess = {
    requireCurrentAccess: async () => ({
      organizationId,
      userId,
      membershipId,
      permissions: new Set(granted),
    }),
  } as unknown as TenantAccessService;
  return new PermissionsGuard(reflector, tenantAccess);
}

test("permission guard allows an active tenant member with all required permissions", async () => {
  assert.equal(await createGuard([Permissions.JobRead]).canActivate(context), true);
});

test("permission guard rejects a missing database-derived permission", async () => {
  await assert.rejects(() => createGuard([]).canActivate(context), ForbiddenException);
});

test("permission guard propagates authentication failure from tenant access resolution", async () => {
  const reflector = { getAllAndOverride: () => [Permissions.JobRead] } as unknown as Reflector;
  const tenantAccess = {
    requireCurrentAccess: async () => {
      throw new UnauthorizedException("Authentication is required");
    },
  } as unknown as TenantAccessService;
  const guard = new PermissionsGuard(reflector, tenantAccess);
  await assert.rejects(() => guard.canActivate(context), UnauthorizedException);
});

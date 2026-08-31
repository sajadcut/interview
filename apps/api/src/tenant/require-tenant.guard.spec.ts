import assert from "node:assert/strict";
import test from "node:test";
import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { TenantAccessService } from "../auth/tenant-access.service";
import { RequireTenantGuard } from "./require-tenant.guard";

class TestController {}
function testHandler() {}

const context = {
  getHandler: () => testHandler,
  getClass: () => TestController,
} as unknown as ExecutionContext;

function reflector(required: boolean): Reflector {
  return { getAllAndOverride: () => required } as unknown as Reflector;
}

test("tenant guard leaves public handlers untouched", async () => {
  const access = { requireCurrentAccess: async () => assert.fail("should not resolve access") } as unknown as TenantAccessService;
  const guard = new RequireTenantGuard(reflector(false), access);
  assert.equal(await guard.canActivate(context), true);
});

test("tenant guard requires an active membership when tenant metadata is present", async () => {
  const access = {
    requireCurrentAccess: async () => ({
      organizationId: "22222222-2222-4222-8222-222222222222",
      userId: "11111111-1111-4111-8111-111111111111",
      membershipId: "33333333-3333-4333-8333-333333333333",
      permissions: new Set(),
    }),
  } as unknown as TenantAccessService;
  const guard = new RequireTenantGuard(reflector(true), access);
  assert.equal(await guard.canActivate(context), true);
});

test("tenant guard blocks a tenant context without valid membership", async () => {
  const access = {
    requireCurrentAccess: async () => {
      throw new ForbiddenException("not a member");
    },
  } as unknown as TenantAccessService;
  const guard = new RequireTenantGuard(reflector(true), access);
  await assert.rejects(() => guard.canActivate(context), ForbiddenException);
});

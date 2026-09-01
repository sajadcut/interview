import assert from "node:assert/strict";
import test from "node:test";
import type { ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import { PermissionGuard } from "./permission.guard";

function contextFor(role?: string): ExecutionContext {
  return {
    getHandler: () => function handler() {},
    getClass: () => class TestController {},
    switchToHttp: () => ({
      getRequest: () => (role ? { user: { role } } : {}),
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
}

function reflectorFor(permissions?: string[]): Reflector {
  return {
    getAllAndOverride: () => permissions,
  } as unknown as Reflector;
}

test("PermissionGuard allows routes without permission metadata", () => {
  const guard = new PermissionGuard(reflectorFor());
  assert.equal(guard.canActivate(contextFor()), true);
});

test("PermissionGuard requires every declared permission", () => {
  const allowed = new PermissionGuard(reflectorFor(["scorecards.submit", "evidence.review"]));
  assert.equal(allowed.canActivate(contextFor("INTERVIEWER")), true);

  const denied = new PermissionGuard(reflectorFor(["scorecards.submit", "settings.manage"]));
  assert.equal(denied.canActivate(contextFor("INTERVIEWER")), false);
});

test("PermissionGuard allows platform admin wildcard permission", () => {
  const guard = new PermissionGuard(reflectorFor(["settings.manage", "jobs.manage"]));
  assert.equal(guard.canActivate(contextFor("PLATFORM_ADMIN")), true);
});

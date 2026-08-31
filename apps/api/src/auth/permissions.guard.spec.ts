import assert from "node:assert/strict";
import test from "node:test";
import { ForbiddenException, UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthContextService } from "./auth-context.service";
import { PermissionsGuard } from "./permissions.guard";
import { Permissions } from "./permissions";

const context = {} as ExecutionContext;
const userId = "11111111-1111-4111-8111-111111111111";

function createGuard(auth: AuthContextService, required = [Permissions.JobRead]) {
  const reflector = {
    getAllAndOverride: () => required,
  } as unknown as Reflector;
  return new PermissionsGuard(reflector, auth);
}

test("permission guard allows a principal with all required permissions", () => {
  const auth = new AuthContextService();
  const guard = createGuard(auth);
  const allowed = auth.run(
    { userId, permissions: new Set([Permissions.JobRead]) },
    () => guard.canActivate(context),
  );
  assert.equal(allowed, true);
});

test("permission guard rejects a missing permission", () => {
  const auth = new AuthContextService();
  const guard = createGuard(auth);
  assert.throws(
    () => auth.run({ userId, permissions: new Set() }, () => guard.canActivate(context)),
    ForbiddenException,
  );
});

test("permission guard rejects an unauthenticated request", () => {
  const auth = new AuthContextService();
  const guard = createGuard(auth);
  assert.throws(() => guard.canActivate(context), UnauthorizedException);
});

import assert from "node:assert/strict";
import test from "node:test";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import type { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import { AuthContextService } from "./auth-context.service";
import { Permissions } from "./permissions";
import { TenantAccessService } from "./tenant-access.service";

const organizationId = "22222222-2222-4222-8222-222222222222";
const userId = "11111111-1111-4111-8111-111111111111";
const membershipId = "33333333-3333-4333-8333-333333333333";

function databaseReturning(rows: unknown[]): DatabaseService {
  const sql = async (strings: TemplateStringsArray) => {
    const text = Array.from(strings).join("?");
    if (text.includes("FROM platform_user_roles")) return [];
    return rows;
  };
  return { sql } as unknown as DatabaseService;
}

test("tenant access resolves permissions from active database membership", async () => {
  const tenant = new TenantContextService();
  const auth = new AuthContextService();
  const service = new TenantAccessService(
    databaseReturning([
      {
        membership_id: membershipId,
        permission_keys: [Permissions.JobRead, "future.unknown_permission"],
      },
    ]),
    tenant,
    auth,
  );

  const access = await tenant.run(organizationId, () =>
    auth.run({ userId, source: "development-header" }, () => service.requireCurrentAccess()),
  );

  assert.equal(access.organizationId, organizationId);
  assert.equal(access.userId, userId);
  assert.equal(access.membershipId, membershipId);
  assert.deepEqual([...access.permissions], [Permissions.JobRead]);
});

test("tenant access rejects a request without authentication", async () => {
  const tenant = new TenantContextService();
  const auth = new AuthContextService();
  const service = new TenantAccessService(databaseReturning([]), tenant, auth);
  await assert.rejects(
    () => tenant.run(organizationId, () => service.requireCurrentAccess()),
    UnauthorizedException,
  );
});

test("tenant access rejects a user without active organization membership", async () => {
  const tenant = new TenantContextService();
  const auth = new AuthContextService();
  const service = new TenantAccessService(databaseReturning([]), tenant, auth);
  await assert.rejects(
    () =>
      tenant.run(organizationId, () =>
        auth.run({ userId, source: "development-header" }, () => service.requireCurrentAccess()),
      ),
    ForbiddenException,
  );
});

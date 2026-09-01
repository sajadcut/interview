import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import { AuthContextService } from "./auth-context.service";
import { Permissions, type Permission } from "./permissions";

export interface TenantAccess {
  organizationId: string;
  userId: string;
  membershipId: string | null;
  platformAdmin: boolean;
  permissions: ReadonlySet<Permission>;
}

const knownPermissions = new Set<string>(Object.values(Permissions));
const allPermissions = new Set<Permission>(Object.values(Permissions));

function isPermission(value: string): value is Permission {
  return knownPermissions.has(value);
}

@Injectable()
export class TenantAccessService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
    private readonly authContext: AuthContextService,
  ) {}

  async requireCurrentAccess(): Promise<TenantAccess> {
    const tenant = this.tenantContext.getOptional();
    if (!tenant) throw new BadRequestException("x-organization-id is required");

    const principal = this.authContext.getOptional();
    if (!principal) throw new UnauthorizedException("Authentication is required");

    const platformRows = await this.database.sql`
      SELECT 1
      FROM platform_user_roles pur
      JOIN organizations o ON o.id = ${tenant.organizationId}::uuid
      WHERE pur.user_id = ${principal.userId}::uuid
        AND pur.role_key = 'PLATFORM_ADMIN'
        AND pur.revoked_at IS NULL
      LIMIT 1
    `;
    if (platformRows.length > 0) {
      return {
        organizationId: tenant.organizationId,
        userId: principal.userId,
        membershipId: null,
        platformAdmin: true,
        permissions: allPermissions,
      };
    }

    const rows = await this.database.sql`
      SELECT
        m.id::text AS membership_id,
        COALESCE(
          array_agg(DISTINCT p.key) FILTER (WHERE p.key IS NOT NULL),
          ARRAY[]::varchar[]
        ) AS permission_keys
      FROM memberships m
      LEFT JOIN membership_roles mr
        ON mr.membership_id = m.id
       AND mr.organization_id = m.organization_id
      LEFT JOIN roles r
        ON r.id = mr.role_id
       AND r.organization_id = m.organization_id
      LEFT JOIN role_permissions rp ON rp.role_id = r.id
      LEFT JOIN permissions p ON p.id = rp.permission_id
      WHERE m.organization_id = ${tenant.organizationId}::uuid
        AND m.user_id = ${principal.userId}::uuid
        AND m.status = 'active'
      GROUP BY m.id
      LIMIT 1
    `;

    const row = rows[0] as { membership_id?: unknown; permission_keys?: unknown } | undefined;
    if (!row || typeof row.membership_id !== "string") {
      throw new ForbiddenException("User is not an active member of this organization");
    }

    const keys = Array.isArray(row.permission_keys)
      ? row.permission_keys.filter((value): value is string => typeof value === "string")
      : [];

    return {
      organizationId: tenant.organizationId,
      userId: principal.userId,
      membershipId: row.membership_id,
      platformAdmin: false,
      permissions: new Set(keys.filter(isPermission)),
    };
  }
}

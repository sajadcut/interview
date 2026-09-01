import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import { AuthContextService } from "../auth/auth-context.service";
import { PasswordHasherService } from "../auth/password-hasher.service";
import { getEnv } from "../config/env";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import type {
  AcceptOrganizationInvitationDto,
  InviteOrganizationUserDto,
  UpdateOrganizationUserRoleDto,
  UpdateOrganizationUserStatusDto,
} from "./organization-users.dto";
import type { OrganizationRole } from "./membership-role.types";
import {
  isOrganizationRole,
  ORGANIZATION_ROLE_PERMISSIONS,
  ORGANIZATION_ROLES,
  roleDisplayName,
} from "./organization-role-policy";

const INVITATION_TTL_HOURS = 72;
const CANONICAL_ROLE_KEYS = [...ORGANIZATION_ROLES, "org_admin"] as const;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function tokenHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function secureToken(): string {
  return randomBytes(32).toString("base64url");
}

function asIso(value: unknown): string {
  return new Date(String(value)).toISOString();
}

@Injectable()
export class OrganizationUsersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
    private readonly authContext: AuthContextService,
    private readonly passwords: PasswordHasherService,
    private readonly audit: AuditService,
  ) {}

  async listUsers() {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      SELECT
        u.id::text AS user_id,
        m.id::text AS membership_id,
        u.email,
        u.display_name,
        m.status,
        u.last_login_at,
        COALESCE(
          array_agg(DISTINCT r.key) FILTER (WHERE r.key IS NOT NULL),
          ARRAY[]::varchar[]
        ) AS role_keys
      FROM memberships m
      JOIN users u ON u.id = m.user_id
      LEFT JOIN membership_roles mr
        ON mr.membership_id = m.id AND mr.organization_id = m.organization_id
      LEFT JOIN roles r
        ON r.id = mr.role_id AND r.organization_id = m.organization_id
      WHERE m.organization_id = ${organizationId}::uuid
      GROUP BY u.id, m.id
      ORDER BY lower(u.email)
    `;

    return rows.map((row) => ({
      userId: String(row.user_id),
      membershipId: String(row.membership_id),
      email: String(row.email),
      ...(row.display_name ? { displayName: String(row.display_name) } : {}),
      status: String(row.status),
      roles: Array.isArray(row.role_keys)
        ? row.role_keys.filter((value): value is string => typeof value === "string")
        : [],
      ...(row.last_login_at ? { lastLoginAt: asIso(row.last_login_at) } : {}),
    }));
  }

  async listInvitations() {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      SELECT id::text, target_email, role_key, expires_at, created_at
      FROM invitation_tokens
      WHERE organization_id = ${organizationId}::uuid
        AND purpose = 'organization_user_invite'
        AND consumed_at IS NULL
        AND expires_at > now()
      ORDER BY created_at DESC
    `;
    return rows.map((row) => ({
      id: String(row.id),
      email: String(row.target_email),
      role: String(row.role_key),
      expiresAt: asIso(row.expires_at),
      createdAt: asIso(row.created_at),
      deliveryRequired: true,
    }));
  }

  async invite(input: InviteOrganizationUserDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const actorUserId = this.authContext.getOptional()?.userId;
    if (!actorUserId) throw new UnauthorizedException("Authentication is required");
    const email = normalizeEmail(input.email);

    const existing = await this.database.sql`
      SELECT m.status
      FROM users u
      JOIN memberships m ON m.user_id = u.id
      WHERE m.organization_id = ${organizationId}::uuid
        AND lower(u.email) = ${email}
      LIMIT 1
    `;
    if (existing.length > 0) {
      throw new ConflictException(
        String(existing[0]?.status) === "active"
          ? "User is already an active organization member"
          : "User already belongs to this organization; reactivate the membership instead",
      );
    }

    await this.ensureRole(organizationId, input.role);
    const rawToken = secureToken();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_HOURS * 60 * 60 * 1000);

    const rows = await this.database.sql.begin(async (tx) => {
      await tx`
        UPDATE invitation_tokens
        SET consumed_at = now()
        WHERE organization_id = ${organizationId}::uuid
          AND lower(target_email) = ${email}
          AND purpose = 'organization_user_invite'
          AND consumed_at IS NULL
      `;
      return tx`
        INSERT INTO invitation_tokens (
          organization_id,
          target_email,
          purpose,
          token_hash,
          role_key,
          expires_at,
          created_by_user_id
        ) VALUES (
          ${organizationId}::uuid,
          ${email},
          'organization_user_invite',
          ${tokenHash(rawToken)},
          ${input.role},
          ${expiresAt},
          ${actorUserId}::uuid
        )
        RETURNING id::text, created_at
      `;
    });

    const invitationId = String(rows[0]?.id);
    await this.audit.record({
      action: "organization.user.invite",
      entityType: "organization_user_invitation",
      entityId: invitationId,
      after: { email, role: input.role, expiresAt: expiresAt.toISOString() },
    });

    return {
      id: invitationId,
      email,
      role: input.role,
      expiresAt: expiresAt.toISOString(),
      createdAt: asIso(rows[0]?.created_at),
      deliveryRequired: true,
      ...(getEnv().NODE_ENV !== "production" ? { developmentToken: rawToken } : {}),
    };
  }

  async changeRole(userId: string, input: UpdateOrganizationUserRoleDto) {
    const organizationId = this.tenantContext.require().organizationId;
    await this.requireMembership(organizationId, userId);
    await this.ensureRole(organizationId, input.role);

    const previousRoles = await this.getMembershipRoles(organizationId, userId);
    if (
      !["ORGANIZATION_ADMIN", "PLATFORM_ADMIN"].includes(input.role) &&
      previousRoles.some((role) => role === "ORGANIZATION_ADMIN" || role === "org_admin")
    ) {
      await this.assertAnotherActiveAdminExists(organizationId, userId);
    }

    await this.database.sql.begin(async (tx) => {
      await tx`
        DELETE FROM membership_roles mr
        USING memberships m, roles r
        WHERE mr.membership_id = m.id
          AND mr.role_id = r.id
          AND mr.organization_id = ${organizationId}::uuid
          AND m.organization_id = ${organizationId}::uuid
          AND m.user_id = ${userId}::uuid
          AND r.key = ANY(${CANONICAL_ROLE_KEYS}::varchar[])
      `;
      await tx`
        INSERT INTO membership_roles (organization_id, membership_id, role_id)
        SELECT m.organization_id, m.id, r.id
        FROM memberships m
        JOIN roles r ON r.organization_id = m.organization_id AND r.key = ${input.role}
        WHERE m.organization_id = ${organizationId}::uuid
          AND m.user_id = ${userId}::uuid
        ON CONFLICT (membership_id, role_id) DO UPDATE
          SET organization_id = EXCLUDED.organization_id
      `;
    });

    await this.audit.record({
      action: "organization.user.role_change",
      entityType: "user",
      entityId: userId,
      before: { roles: previousRoles },
      after: { roles: [input.role] },
    });
    return { userId, role: input.role };
  }

  async setStatus(userId: string, input: UpdateOrganizationUserStatusDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const principal = this.authContext.getOptional();
    if (input.status === "disabled" && principal?.userId === userId) {
      throw new BadRequestException("You cannot disable your own organization membership");
    }

    const membership = await this.requireMembership(organizationId, userId);
    if (input.status === "disabled") {
      const roles = await this.getMembershipRoles(organizationId, userId);
      if (roles.some((role) => role === "ORGANIZATION_ADMIN" || role === "org_admin")) {
        await this.assertAnotherActiveAdminExists(organizationId, userId);
      }
    }

    await this.database.sql`
      UPDATE memberships
      SET status = ${input.status}, updated_at = now()
      WHERE organization_id = ${organizationId}::uuid
        AND user_id = ${userId}::uuid
    `;
    await this.audit.record({
      action: "organization.user.status_change",
      entityType: "user",
      entityId: userId,
      before: { status: membership.status },
      after: { status: input.status },
    });
    return { userId, status: input.status };
  }

  async remove(userId: string): Promise<void> {
    const organizationId = this.tenantContext.require().organizationId;
    const principal = this.authContext.getOptional();
    if (principal?.userId === userId) {
      throw new BadRequestException("You cannot remove your own organization membership");
    }

    await this.requireMembership(organizationId, userId);
    const roles = await this.getMembershipRoles(organizationId, userId);
    if (roles.some((role) => role === "ORGANIZATION_ADMIN" || role === "org_admin")) {
      await this.assertAnotherActiveAdminExists(organizationId, userId);
    }

    await this.database.sql`
      DELETE FROM memberships
      WHERE organization_id = ${organizationId}::uuid
        AND user_id = ${userId}::uuid
    `;
    await this.audit.record({
      action: "organization.user.remove",
      entityType: "user",
      entityId: userId,
      before: { roles },
    });
  }

  async acceptInvitation(input: AcceptOrganizationInvitationDto) {
    const hash = tokenHash(input.token);
    const passwordHash = await this.passwords.hashPassword(input.password);

    return this.database.sql.begin(async (tx) => {
      const invitations = await tx`
        SELECT
          id::text,
          organization_id::text,
          target_email,
          role_key
        FROM invitation_tokens
        WHERE token_hash = ${hash}
          AND purpose = 'organization_user_invite'
          AND consumed_at IS NULL
          AND expires_at > now()
          AND (locked_until IS NULL OR locked_until <= now())
        LIMIT 1
        FOR UPDATE
      `;
      const invitation = invitations[0];
      if (!invitation) throw new UnauthorizedException("Invitation is invalid or expired");

      const organizationId = String(invitation.organization_id);
      const roleKey = String(invitation.role_key ?? "");
      if (!isOrganizationRole(roleKey)) {
        throw new ConflictException("Invitation role is no longer supported");
      }

      const roleRows = await tx`
        SELECT id::text
        FROM roles
        WHERE organization_id = ${organizationId}::uuid AND key = ${roleKey}
        LIMIT 1
      `;
      if (!roleRows[0]?.id) throw new ConflictException("Invitation role is not provisioned");
      const roleId = String(roleRows[0].id);
      const email = normalizeEmail(String(invitation.target_email));

      let userRows = await tx`
        SELECT id::text, display_name
        FROM users
        WHERE lower(email) = ${email}
        LIMIT 1
      `;
      let existingAccount = userRows.length > 0;
      if (!existingAccount) {
        const inserted = await tx`
          INSERT INTO users (email, display_name)
          VALUES (${email}, ${input.displayName.trim()})
          ON CONFLICT DO NOTHING
          RETURNING id::text, display_name
        `;
        userRows = inserted.length > 0
          ? inserted
          : await tx`
              SELECT id::text, display_name
              FROM users
              WHERE lower(email) = ${email}
              LIMIT 1
            `;
        existingAccount = inserted.length === 0;
      }
      const userId = String(userRows[0]?.id ?? "");
      if (!userId) throw new ConflictException("Unable to resolve invited user");

      await tx`
        UPDATE users
        SET display_name = COALESCE(display_name, ${input.displayName.trim()}), updated_at = now()
        WHERE id = ${userId}::uuid
      `;

      const membershipRows = await tx`
        INSERT INTO memberships (organization_id, user_id, status)
        VALUES (${organizationId}::uuid, ${userId}::uuid, 'active')
        ON CONFLICT (organization_id, user_id)
        DO UPDATE SET status = 'active', updated_at = now()
        RETURNING id::text
      `;
      const membershipId = String(membershipRows[0]?.id);

      await tx`
        DELETE FROM membership_roles mr
        USING roles r
        WHERE mr.membership_id = ${membershipId}::uuid
          AND mr.organization_id = ${organizationId}::uuid
          AND mr.role_id = r.id
          AND r.key = ANY(${CANONICAL_ROLE_KEYS}::varchar[])
      `;
      await tx`
        INSERT INTO membership_roles (organization_id, membership_id, role_id)
        VALUES (${organizationId}::uuid, ${membershipId}::uuid, ${roleId}::uuid)
        ON CONFLICT (membership_id, role_id) DO UPDATE
          SET organization_id = EXCLUDED.organization_id
      `;

      const credentialRows = await tx`
        INSERT INTO credentials (user_id, password_hash)
        VALUES (${userId}::uuid, ${passwordHash})
        ON CONFLICT (user_id) DO NOTHING
        RETURNING id::text
      `;
      const credentialCreated = credentialRows.length > 0;

      await tx`
        UPDATE invitation_tokens
        SET consumed_at = now()
        WHERE id = ${String(invitation.id)}::uuid
      `;
      await tx`
        INSERT INTO audit_events (
          organization_id, actor_type, actor_user_id, action, entity_type, entity_id, metadata
        ) VALUES (
          ${organizationId}::uuid,
          'user',
          ${userId}::uuid,
          'organization.user.invite.accept',
          'membership',
          ${membershipId},
          ${this.database.sql.json({ invitationId: String(invitation.id), role: roleKey } as never)}
        )
      `;

      return {
        accepted: true,
        organizationId,
        userId,
        membershipId,
        role: roleKey,
        existingAccount,
        credentialCreated,
      };
    });
  }

  private async ensureRole(organizationId: string, role: OrganizationRole): Promise<void> {
    const roleRows = await this.database.sql`
      INSERT INTO roles (organization_id, key, name)
      VALUES (${organizationId}::uuid, ${role}, ${roleDisplayName(role)})
      ON CONFLICT (organization_id, key) DO UPDATE SET name = EXCLUDED.name
      RETURNING id::text
    `;
    const roleId = String(roleRows[0]?.id);
    const permissionKeys = ORGANIZATION_ROLE_PERMISSIONS[role];
    await this.database.sql`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT ${roleId}::uuid, p.id
      FROM permissions p
      WHERE p.key = ANY(${permissionKeys}::varchar[])
      ON CONFLICT (role_id, permission_id) DO NOTHING
    `;
  }

  private async requireMembership(organizationId: string, userId: string) {
    const rows = await this.database.sql`
      SELECT id::text, status
      FROM memberships
      WHERE organization_id = ${organizationId}::uuid AND user_id = ${userId}::uuid
      LIMIT 1
    `;
    if (!rows[0]) throw new NotFoundException("Organization user was not found");
    return { membershipId: String(rows[0].id), status: String(rows[0].status) };
  }

  private async getMembershipRoles(organizationId: string, userId: string): Promise<string[]> {
    const rows = await this.database.sql`
      SELECT r.key
      FROM memberships m
      JOIN membership_roles mr
        ON mr.membership_id = m.id AND mr.organization_id = m.organization_id
      JOIN roles r ON r.id = mr.role_id AND r.organization_id = m.organization_id
      WHERE m.organization_id = ${organizationId}::uuid
        AND m.user_id = ${userId}::uuid
      ORDER BY r.key
    `;
    return rows.map((row) => String(row.key));
  }

  private async assertAnotherActiveAdminExists(organizationId: string, excludedUserId: string) {
    const rows = await this.database.sql`
      SELECT count(DISTINCT m.id)::int AS admin_count
      FROM memberships m
      JOIN membership_roles mr
        ON mr.membership_id = m.id AND mr.organization_id = m.organization_id
      JOIN roles r ON r.id = mr.role_id AND r.organization_id = m.organization_id
      WHERE m.organization_id = ${organizationId}::uuid
        AND m.status = 'active'
        AND m.user_id <> ${excludedUserId}::uuid
        AND r.key IN ('ORGANIZATION_ADMIN', 'PLATFORM_ADMIN', 'org_admin')
    `;
    if (Number(rows[0]?.admin_count ?? 0) < 1) {
      throw new ConflictException("At least one active organization administrator must remain");
    }
  }
}

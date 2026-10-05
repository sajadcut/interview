import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { OrganizationUsersService } from "../organizations/organization-users.service";
import { ORGANIZATION_ROLE_PERMISSIONS } from "../organizations/organization-role-policy";
import { TenantContextService } from "../tenant/tenant-context.service";
import type {
  CreateInterviewerProfileDto,
  UpdateInterviewerProfileDto,
} from "./interviewer-profile.dto";

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function cleanOptional(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

@Injectable()
export class InterviewerProfileService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
    private readonly organizationUsers: OrganizationUsersService,
  ) {}

  async list() {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      SELECT
        ip.id::text,
        ip.email,
        ip.first_name,
        ip.last_name,
        ip.phone,
        ip.job_title,
        ip.specialties,
        ip.bio,
        ip.status,
        ip.updated_at,
        u.id::text AS user_id,
        m.status AS membership_status,
        EXISTS (
          SELECT 1
          FROM membership_roles mr
          JOIN roles r
            ON r.id = mr.role_id
           AND r.organization_id = mr.organization_id
          WHERE mr.organization_id = ip.organization_id
            AND mr.membership_id = m.id
            AND r.key = 'INTERVIEWER'
        ) AS has_interviewer_role,
        EXISTS (
          SELECT 1
          FROM invitation_tokens it
          WHERE it.organization_id = ip.organization_id
            AND lower(it.target_email) = lower(ip.email)
            AND it.purpose = 'organization_user_invite'
            AND it.role_key = 'INTERVIEWER'
            AND it.consumed_at IS NULL
            AND it.expires_at > now()
        ) AS invitation_pending,
        CASE
          WHEN u.id IS NULL THEN 0
          ELSE (
            SELECT count(*)::int
            FROM interview_assignments ia
            WHERE ia.organization_id = ip.organization_id
              AND ia.interviewer_user_id = u.id
              AND ia.status <> 'cancelled'
          )
        END AS assignment_count
      FROM interviewer_profiles ip
      LEFT JOIN users u ON lower(u.email) = lower(ip.email)
      LEFT JOIN memberships m
        ON m.organization_id = ip.organization_id
       AND m.user_id = u.id
      WHERE ip.organization_id = ${organizationId}::uuid
      ORDER BY lower(ip.last_name), lower(ip.first_name), lower(ip.email)
    `;

    return rows.map((row) => this.mapRow(row));
  }

  async create(input: CreateInterviewerProfileDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const email = normalizeEmail(input.email);
    const existing = await this.database.sql`
      SELECT id::text
      FROM interviewer_profiles
      WHERE organization_id = ${organizationId}::uuid
        AND lower(email) = ${email}
      LIMIT 1
    `;
    if (existing[0]) throw new ConflictException("Interviewer profile already exists for this email");

    const inserted = await this.database.sql`
      INSERT INTO interviewer_profiles (
        organization_id,
        email,
        first_name,
        last_name,
        phone,
        job_title,
        specialties,
        bio,
        status
      ) VALUES (
        ${organizationId}::uuid,
        ${email},
        ${input.firstName.trim()},
        ${input.lastName.trim()},
        ${cleanOptional(input.phone) ?? null},
        ${cleanOptional(input.jobTitle) ?? null},
        ${(input.specialties ?? []).map((item) => item.trim()).filter(Boolean)}::text[],
        ${cleanOptional(input.bio) ?? null},
        'active'
      )
      RETURNING id::text
    `;
    const profileId = String(inserted[0]?.id ?? "");
    if (!profileId) throw new ConflictException("Unable to create interviewer profile");

    try {
      const membership = await this.database.sql`
        SELECT u.id::text AS user_id, m.status
        FROM users u
        JOIN memberships m
          ON m.user_id = u.id
         AND m.organization_id = ${organizationId}::uuid
        WHERE lower(u.email) = ${email}
        LIMIT 1
      `;
      if (membership[0]?.user_id) {
        const userId = String(membership[0].user_id);
        if (String(membership[0].status) !== "active") {
          await this.database.sql`
            UPDATE memberships
            SET status = 'active', updated_at = now()
            WHERE organization_id = ${organizationId}::uuid
              AND user_id = ${userId}::uuid
          `;
        }
        await this.ensureInterviewerRole(organizationId, userId);
      } else {
        await this.organizationUsers.invite({ email, role: "INTERVIEWER" });
      }
    } catch (cause) {
      await this.database.sql`
        DELETE FROM interviewer_profiles
        WHERE organization_id = ${organizationId}::uuid
          AND id = ${profileId}::uuid
      `;
      throw cause;
    }

    return this.get(profileId);
  }

  async update(profileId: string, input: UpdateInterviewerProfileDto) {
    const organizationId = this.tenantContext.require().organizationId;
    await this.requireProfile(profileId);

    const phone = cleanOptional(input.phone);
    const jobTitle = cleanOptional(input.jobTitle);
    const bio = cleanOptional(input.bio);
    const specialties = input.specialties?.map((item) => item.trim()).filter(Boolean);

    await this.database.sql`
      UPDATE interviewer_profiles
      SET
        first_name = CASE WHEN ${input.firstName !== undefined} THEN ${input.firstName?.trim() ?? ""} ELSE first_name END,
        last_name = CASE WHEN ${input.lastName !== undefined} THEN ${input.lastName?.trim() ?? ""} ELSE last_name END,
        phone = CASE WHEN ${input.phone !== undefined} THEN ${phone ?? null} ELSE phone END,
        job_title = CASE WHEN ${input.jobTitle !== undefined} THEN ${jobTitle ?? null} ELSE job_title END,
        specialties = CASE WHEN ${input.specialties !== undefined} THEN ${specialties ?? []}::text[] ELSE specialties END,
        bio = CASE WHEN ${input.bio !== undefined} THEN ${bio ?? null} ELSE bio END,
        status = CASE WHEN ${input.status !== undefined} THEN ${input.status ?? "active"} ELSE status END,
        updated_at = now()
      WHERE organization_id = ${organizationId}::uuid
        AND id = ${profileId}::uuid
    `;

    if (input.status) {
      const profile = await this.requireProfile(profileId);
      const users = await this.database.sql`
        SELECT u.id::text AS user_id
        FROM users u
        JOIN memberships m
          ON m.user_id = u.id
         AND m.organization_id = ${organizationId}::uuid
        WHERE lower(u.email) = lower(${profile.email})
        LIMIT 1
      `;
      const userId = users[0]?.user_id ? String(users[0].user_id) : undefined;
      if (userId && input.status === "active") {
        await this.ensureInterviewerRole(organizationId, userId);
      } else if (userId && input.status === "disabled") {
        await this.removeInterviewerRole(organizationId, userId);
      }
    }

    return this.get(profileId);
  }

  async remove(profileId: string): Promise<void> {
    const organizationId = this.tenantContext.require().organizationId;
    const profile = await this.requireProfile(profileId);
    const users = await this.database.sql`
      SELECT u.id::text AS user_id
      FROM users u
      LEFT JOIN memberships m
        ON m.user_id = u.id
       AND m.organization_id = ${organizationId}::uuid
      WHERE lower(u.email) = lower(${profile.email})
      LIMIT 1
    `;
    const userId = users[0]?.user_id ? String(users[0].user_id) : undefined;

    if (userId) {
      const activeAssignments = await this.database.sql`
        SELECT count(*)::int AS count
        FROM interview_assignments ia
        JOIN interview_sessions s
          ON s.organization_id = ia.organization_id
         AND s.id = ia.interview_session_id
        WHERE ia.organization_id = ${organizationId}::uuid
          AND ia.interviewer_user_id = ${userId}::uuid
          AND ia.status <> 'cancelled'
          AND s.status NOT IN ('completed', 'cancelled', 'failed')
      `;
      if (Number(activeAssignments[0]?.count ?? 0) > 0) {
        throw new ConflictException("Interviewer has active interview assignments and cannot be deleted");
      }
    }

    await this.database.sql.begin(async (tx) => {
      await tx`
        DELETE FROM interviewer_profiles
        WHERE organization_id = ${organizationId}::uuid
          AND id = ${profileId}::uuid
      `;
      await tx`
        UPDATE invitation_tokens
        SET consumed_at = now()
        WHERE organization_id = ${organizationId}::uuid
          AND lower(target_email) = lower(${profile.email})
          AND purpose = 'organization_user_invite'
          AND role_key = 'INTERVIEWER'
          AND consumed_at IS NULL
      `;
    });

    if (userId) await this.removeInterviewerRole(organizationId, userId);
  }

  private async get(profileId: string) {
    const rows = await this.list();
    const profile = rows.find((item) => item.id === profileId);
    if (!profile) throw new NotFoundException("Interviewer profile not found");
    return profile;
  }

  private async requireProfile(profileId: string): Promise<{ email: string }> {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      SELECT email
      FROM interviewer_profiles
      WHERE organization_id = ${organizationId}::uuid
        AND id = ${profileId}::uuid
      LIMIT 1
    `;
    if (!rows[0]) throw new NotFoundException("Interviewer profile not found");
    return { email: String(rows[0].email) };
  }

  private mapRow(row: Record<string, unknown>) {
    const status = String(row.status);
    const activeAccount =
      Boolean(row.user_id) &&
      String(row.membership_status ?? "") === "active" &&
      row.has_interviewer_role === true;
    const effectiveStatus =
      status === "disabled" ? "disabled" : activeAccount ? "active" : "pending";
    return {
      id: String(row.id),
      email: String(row.email),
      firstName: String(row.first_name),
      lastName: String(row.last_name),
      ...(row.phone ? { phone: String(row.phone) } : {}),
      ...(row.job_title ? { jobTitle: String(row.job_title) } : {}),
      specialties: Array.isArray(row.specialties)
        ? row.specialties.filter((value): value is string => typeof value === "string")
        : [],
      ...(row.bio ? { bio: String(row.bio) } : {}),
      status,
      effectiveStatus,
      ...(row.user_id ? { userId: String(row.user_id) } : {}),
      assignmentCount: Number(row.assignment_count ?? 0),
      invitationPending: row.invitation_pending === true,
      updatedAt: new Date(String(row.updated_at)).toISOString(),
    };
  }

  private async ensureInterviewerRole(organizationId: string, userId: string): Promise<void> {
    const roleRows = await this.database.sql`
      INSERT INTO roles (organization_id, key, name)
      VALUES (${organizationId}::uuid, 'INTERVIEWER', 'Interviewer')
      ON CONFLICT (organization_id, key) DO UPDATE SET name = EXCLUDED.name
      RETURNING id::text
    `;
    const roleId = String(roleRows[0]?.id ?? "");
    const permissionKeys = ORGANIZATION_ROLE_PERMISSIONS.INTERVIEWER;
    await this.database.sql`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT ${roleId}::uuid, p.id
      FROM permissions p
      WHERE p.key = ANY(${permissionKeys}::varchar[])
      ON CONFLICT (role_id, permission_id) DO NOTHING
    `;
    await this.database.sql`
      INSERT INTO membership_roles (organization_id, membership_id, role_id)
      SELECT m.organization_id, m.id, ${roleId}::uuid
      FROM memberships m
      WHERE m.organization_id = ${organizationId}::uuid
        AND m.user_id = ${userId}::uuid
      ON CONFLICT (membership_id, role_id) DO UPDATE
        SET organization_id = EXCLUDED.organization_id
    `;
  }

  private async removeInterviewerRole(organizationId: string, userId: string): Promise<void> {
    await this.database.sql`
      DELETE FROM membership_roles mr
      USING memberships m, roles r
      WHERE mr.organization_id = ${organizationId}::uuid
        AND mr.membership_id = m.id
        AND m.organization_id = ${organizationId}::uuid
        AND m.user_id = ${userId}::uuid
        AND mr.role_id = r.id
        AND r.organization_id = ${organizationId}::uuid
        AND r.key = 'INTERVIEWER'
    `;
  }
}

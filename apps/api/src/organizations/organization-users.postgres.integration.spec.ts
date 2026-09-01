import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { AuditService } from "../audit/audit.service";
import { AuthContextService } from "../auth/auth-context.service";
import { PasswordHasherService } from "../auth/password-hasher.service";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import { OrganizationUsersService } from "./organization-users.service";

const integrationDatabaseUrl = process.env.AUTH_INTEGRATION_DATABASE_URL;

test(
  "organization user lifecycle persists invitation, role, status, removal and audit events",
  { skip: !integrationDatabaseUrl },
  async () => {
    const database = new DatabaseService();
    const tenantContext = new TenantContextService();
    const authContext = new AuthContextService();
    const passwords = new PasswordHasherService();
    const audit = new AuditService(database, tenantContext, authContext);
    const users = new OrganizationUsersService(
      database,
      tenantContext,
      authContext,
      passwords,
      audit,
    );

    const organizationId = randomUUID();
    const actorUserId = randomUUID();
    const suffix = randomUUID();
    const actorEmail = `organization-admin-${suffix}@example.invalid`;
    const invitedEmail = `organization-invite-${suffix}@example.invalid`;
    const slug = `organization-users-${suffix}`;

    const asActor = <T>(callback: () => T): T =>
      tenantContext.run(organizationId, () =>
        authContext.run({ userId: actorUserId, source: "session" }, callback),
      );

    try {
      await database.sql`
        INSERT INTO organizations (id, name, slug)
        VALUES (${organizationId}::uuid, 'Organization Users Integration', ${slug})
      `;
      await database.sql`
        INSERT INTO users (id, email, display_name)
        VALUES (${actorUserId}::uuid, ${actorEmail}, 'Organization Admin')
      `;
      await database.sql`
        INSERT INTO memberships (organization_id, user_id, status)
        VALUES (${organizationId}::uuid, ${actorUserId}::uuid, 'active')
      `;

      const invitation = await asActor(() =>
        users.invite({ email: invitedEmail, role: "RECRUITER" }),
      );
      assert.equal(invitation.email, invitedEmail);
      assert.equal(invitation.role, "RECRUITER");
      assert.equal(invitation.deliveryRequired, true);
      assert.ok(invitation.developmentToken, "test environment must expose the development token");

      const storedInvitation = await database.sql`
        SELECT token_hash, consumed_at
        FROM invitation_tokens
        WHERE id = ${invitation.id}::uuid
      `;
      assert.equal(storedInvitation.length, 1);
      assert.notEqual(String(storedInvitation[0]?.token_hash), invitation.developmentToken);
      assert.equal(storedInvitation[0]?.consumed_at, null);

      const accepted = await users.acceptInvitation({
        token: invitation.developmentToken,
        displayName: "Invited Recruiter",
        password: "correct horse battery staple",
      });
      assert.equal(accepted.accepted, true);
      assert.equal(accepted.organizationId, organizationId);
      assert.equal(accepted.role, "RECRUITER");
      assert.equal(accepted.credentialCreated, true);

      const listed = await asActor(() => users.listUsers());
      const invitedUser = listed.find((user) => user.email === invitedEmail);
      assert.ok(invitedUser);
      assert.equal(invitedUser.status, "active");
      assert.deepEqual(invitedUser.roles, ["RECRUITER"]);

      await asActor(() => users.changeRole(accepted.userId, { role: "INTERVIEWER" }));
      const roleRows = await database.sql`
        SELECT r.key
        FROM memberships m
        JOIN membership_roles mr
          ON mr.membership_id = m.id AND mr.organization_id = m.organization_id
        JOIN roles r
          ON r.id = mr.role_id AND r.organization_id = m.organization_id
        WHERE m.organization_id = ${organizationId}::uuid
          AND m.user_id = ${accepted.userId}::uuid
        ORDER BY r.key
      `;
      assert.deepEqual(roleRows.map((row) => String(row.key)), ["INTERVIEWER"]);

      await asActor(() => users.setStatus(accepted.userId, { status: "disabled" }));
      const disabledMembership = await database.sql`
        SELECT status
        FROM memberships
        WHERE organization_id = ${organizationId}::uuid
          AND user_id = ${accepted.userId}::uuid
      `;
      assert.equal(String(disabledMembership[0]?.status), "disabled");

      await assert.rejects(
        asActor(() => users.setStatus(actorUserId, { status: "disabled" })),
        /cannot disable your own organization membership/i,
      );
      await assert.rejects(
        asActor(() => users.remove(actorUserId)),
        /cannot remove your own organization membership/i,
      );

      await asActor(() => users.remove(accepted.userId));
      const membershipAfterRemoval = await database.sql`
        SELECT 1
        FROM memberships
        WHERE organization_id = ${organizationId}::uuid
          AND user_id = ${accepted.userId}::uuid
      `;
      assert.equal(membershipAfterRemoval.length, 0);
      const globalUserAfterRemoval = await database.sql`
        SELECT 1 FROM users WHERE id = ${accepted.userId}::uuid
      `;
      assert.equal(globalUserAfterRemoval.length, 1, "removing membership must not delete the global user");

      const auditRows = await database.sql`
        SELECT action
        FROM audit_events
        WHERE organization_id = ${organizationId}::uuid
          AND action = ANY(${[
            "organization.user.invite",
            "organization.user.invite.accept",
            "organization.user.role_change",
            "organization.user.status_change",
            "organization.user.remove",
          ]}::varchar[])
      `;
      assert.equal(auditRows.length, 5);
    } finally {
      const invitedRows = await database.sql`
        SELECT id::text FROM users WHERE lower(email) = lower(${invitedEmail})
      `;
      await database.sql`DELETE FROM organizations WHERE id = ${organizationId}::uuid`;
      for (const row of invitedRows) {
        await database.sql`DELETE FROM users WHERE id = ${String(row.id)}::uuid`;
      }
      await database.sql`DELETE FROM users WHERE id = ${actorUserId}::uuid`;
      await database.onModuleDestroy();
    }
  },
);

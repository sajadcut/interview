import { HttpException, Injectable, UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { getEnv } from "../config/env";
import { DatabaseService } from "../database/database.service";
import { ACCOUNT_SECURITY_POLICY } from "./enterprise-auth.constants";
import { PasswordHasherService } from "./password-hasher.service";
import {
  AUTH_RATE_LIMIT_POLICIES,
  AuthRateLimitService,
} from "./security/auth-rate-limit.service";
import { SessionService, type IssuedSession, type SessionMetadata } from "./session.service";

const PASSWORD_RESET_MINUTES = 30;

export interface LoginResult extends IssuedSession {
  email: string;
  displayName: string | null;
}

export interface AuthenticatedOrganization {
  id: string;
  name: string;
  slug: string;
  roles: string[];
}

interface CredentialRow {
  user_id?: unknown;
  email?: unknown;
  display_name?: unknown;
  disabled_at?: unknown;
  password_hash?: unknown;
  failed_login_count?: unknown;
  locked_until?: unknown;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function tokenHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

@Injectable()
export class EnterpriseAuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly passwordHasher: PasswordHasherService,
    private readonly sessions: SessionService,
    private readonly rateLimits: AuthRateLimitService,
  ) {}

  async login(email: string, password: string, metadata: SessionMetadata = {}): Promise<LoginResult> {
    const normalizedEmail = normalizeEmail(email);
    await this.rateLimits.consume("login-email", normalizedEmail, AUTH_RATE_LIMIT_POLICIES.loginEmail);
    if (metadata.ip) {
      await this.rateLimits.consume("login-ip", metadata.ip, AUTH_RATE_LIMIT_POLICIES.loginIp);
    }

    const rows = await this.database.sql`
      SELECT
        u.id::text AS user_id,
        u.email,
        u.display_name,
        u.disabled_at,
        c.password_hash,
        c.failed_login_count,
        c.locked_until
      FROM users u
      JOIN credentials c ON c.user_id = u.id
      WHERE lower(u.email) = ${normalizedEmail}
      LIMIT 1
    `;
    const row = rows[0] as CredentialRow | undefined;

    if (!row || typeof row.user_id !== "string" || typeof row.password_hash !== "string") {
      throw new UnauthorizedException("Invalid email or password");
    }
    const userId = row.user_id;
    if (row.disabled_at != null) {
      await this.recordUserAudit(userId, "auth.login.failed", { reason: "account_disabled" });
      throw new UnauthorizedException("Account is disabled");
    }

    const lockedUntil = row.locked_until == null ? undefined : new Date(String(row.locked_until));
    if (lockedUntil && !Number.isNaN(lockedUntil.getTime()) && lockedUntil.getTime() > Date.now()) {
      await this.recordUserAudit(userId, "auth.login.failed", { reason: "account_locked" });
      throw new HttpException(
        "Account is temporarily locked after repeated failed sign-in attempts",
        423,
      );
    }

    const valid = await this.passwordHasher.verifyPassword(password, row.password_hash);
    if (!valid) {
      await this.database.sql`
        UPDATE credentials
        SET failed_login_count = failed_login_count + 1,
            locked_until = CASE
              WHEN failed_login_count + 1 >= ${ACCOUNT_SECURITY_POLICY.maxFailedAttempts}
                THEN now() + (${ACCOUNT_SECURITY_POLICY.lockMinutes} * interval '1 minute')
              ELSE locked_until
            END,
            updated_at = now()
        WHERE user_id = ${userId}::uuid
      `;
      await this.recordUserAudit(userId, "auth.login.failed", { reason: "invalid_credentials" });
      throw new UnauthorizedException("Invalid email or password");
    }

    await this.database.sql.begin(async (tx) => {
      await tx`
        UPDATE credentials
        SET failed_login_count = 0,
            locked_until = NULL,
            updated_at = now()
        WHERE user_id = ${userId}::uuid
      `;
      await tx`
        UPDATE users
        SET last_login_at = now(), updated_at = now()
        WHERE id = ${userId}::uuid
      `;
    });

    await this.rateLimits.clear("login-email", normalizedEmail);
    if (metadata.ip) await this.rateLimits.clear("login-ip", metadata.ip);

    const issued = await this.sessions.createInternalSession(userId, metadata);
    await this.recordUserAudit(userId, "auth.login", { sessionId: issued.sessionId });
    return {
      ...issued,
      email: typeof row.email === "string" ? row.email : normalizedEmail,
      displayName: typeof row.display_name === "string" ? row.display_name : null,
    };
  }

  async listOrganizations(userId: string): Promise<AuthenticatedOrganization[]> {
    const platformAdminRows = await this.database.sql`
      SELECT 1
      FROM platform_user_roles
      WHERE user_id = ${userId}::uuid
        AND role_key = 'PLATFORM_ADMIN'
        AND revoked_at IS NULL
      LIMIT 1
    `;
    if (platformAdminRows.length > 0) {
      const organizations = await this.database.sql`
        SELECT id::text, name, slug
        FROM organizations
        ORDER BY lower(name)
      `;
      return organizations.map((row) => ({
        id: String(row.id),
        name: String(row.name),
        slug: String(row.slug),
        roles: ["PLATFORM_ADMIN"],
      }));
    }

    const rows = await this.database.sql`
      SELECT
        o.id::text,
        o.name,
        o.slug,
        COALESCE(
          array_agg(DISTINCT r.key) FILTER (WHERE r.key IS NOT NULL),
          ARRAY[]::varchar[]
        ) AS role_keys
      FROM memberships m
      JOIN organizations o ON o.id = m.organization_id
      LEFT JOIN membership_roles mr
        ON mr.membership_id = m.id AND mr.organization_id = m.organization_id
      LEFT JOIN roles r
        ON r.id = mr.role_id AND r.organization_id = m.organization_id
      WHERE m.user_id = ${userId}::uuid
        AND m.status = 'active'
      GROUP BY o.id
      ORDER BY lower(o.name)
    `;

    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      slug: String(row.slug),
      roles: Array.isArray(row.role_keys)
        ? row.role_keys.filter((value): value is string => typeof value === "string")
        : [],
    }));
  }

  async requestPasswordReset(email: string) {
    const normalizedEmail = normalizeEmail(email);
    await this.rateLimits.consume(
      "password-reset-email",
      normalizedEmail,
      AUTH_RATE_LIMIT_POLICIES.passwordReset,
    );

    const users = await this.database.sql`
      SELECT id::text
      FROM users
      WHERE lower(email) = ${normalizedEmail}
        AND disabled_at IS NULL
      LIMIT 1
    `;
    const userId = users[0]?.id ? String(users[0].id) : undefined;
    let developmentToken: string | undefined;

    if (userId) {
      const rawToken = randomBytes(32).toString("base64url");
      developmentToken = rawToken;
      const expiresAt = new Date(Date.now() + PASSWORD_RESET_MINUTES * 60 * 1000);
      await this.database.sql.begin(async (tx) => {
        await tx`
          UPDATE password_reset_tokens
          SET consumed_at = COALESCE(consumed_at, now())
          WHERE user_id = ${userId}::uuid
            AND consumed_at IS NULL
        `;
        await tx`
          INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
          VALUES (${userId}::uuid, ${tokenHash(rawToken)}, ${expiresAt})
        `;
      });
      await this.recordUserAudit(userId, "auth.password_reset.request", {
        expiresAt: expiresAt.toISOString(),
      });
    }

    return {
      accepted: true,
      deliveryRequired: true,
      ...(getEnv().NODE_ENV !== "production" && developmentToken
        ? { developmentToken }
        : {}),
    };
  }

  async resetPassword(rawToken: string, password: string): Promise<{ reset: true }> {
    const passwordHash = await this.passwordHasher.hashPassword(password);
    const hash = tokenHash(rawToken);

    const result = await this.database.sql.begin(async (tx) => {
      const tokens = await tx`
        SELECT id::text, user_id::text
        FROM password_reset_tokens
        WHERE token_hash = ${hash}
          AND consumed_at IS NULL
          AND expires_at > now()
        LIMIT 1
        FOR UPDATE
      `;
      const token = tokens[0];
      if (!token?.user_id) throw new UnauthorizedException("Password reset token is invalid or expired");
      const userId = String(token.user_id);

      await tx`
        INSERT INTO credentials (user_id, password_hash, reset_required)
        VALUES (${userId}::uuid, ${passwordHash}, false)
        ON CONFLICT (user_id) DO UPDATE
        SET password_hash = EXCLUDED.password_hash,
            failed_login_count = 0,
            locked_until = NULL,
            reset_required = false,
            password_changed_at = now(),
            updated_at = now()
      `;
      await tx`
        UPDATE password_reset_tokens
        SET consumed_at = now()
        WHERE id = ${String(token.id)}::uuid
      `;
      await tx`
        UPDATE sessions
        SET revoked_at = COALESCE(revoked_at, now())
        WHERE user_id = ${userId}::uuid AND revoked_at IS NULL
      `;
      await tx`
        UPDATE refresh_tokens rt
        SET revoked_at = COALESCE(rt.revoked_at, now())
        FROM sessions s
        WHERE rt.session_id = s.id
          AND s.user_id = ${userId}::uuid
          AND rt.revoked_at IS NULL
      `;
      return userId;
    });

    await this.recordUserAudit(result, "auth.password_reset.complete");
    return { reset: true };
  }

  async setPassword(userId: string, password: string, resetRequired = false): Promise<void> {
    const passwordHash = await this.passwordHasher.hashPassword(password);
    await this.database.sql`
      INSERT INTO credentials (user_id, password_hash, reset_required)
      VALUES (${userId}::uuid, ${passwordHash}, ${resetRequired})
      ON CONFLICT (user_id) DO UPDATE
      SET password_hash = EXCLUDED.password_hash,
          failed_login_count = 0,
          locked_until = NULL,
          reset_required = EXCLUDED.reset_required,
          password_changed_at = now(),
          updated_at = now()
    `;
    await this.sessions.revokeAllForUser(userId);
  }

  async recordUserAudit(
    userId: string,
    action: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const platformRows = await this.database.sql`
      SELECT 1
      FROM platform_user_roles
      WHERE user_id = ${userId}::uuid
        AND role_key = 'PLATFORM_ADMIN'
        AND revoked_at IS NULL
      LIMIT 1
    `;
    if (platformRows.length > 0) {
      await this.database.sql`
        INSERT INTO audit_events (
          organization_id, actor_type, actor_user_id, action, entity_type, entity_id, metadata
        )
        SELECT
          o.id,
          'user',
          ${userId}::uuid,
          ${action},
          'user',
          ${userId},
          ${metadata ? this.database.sql.json(metadata as never) : null}
        FROM organizations o
      `;
      return;
    }

    await this.database.sql`
      INSERT INTO audit_events (
        organization_id, actor_type, actor_user_id, action, entity_type, entity_id, metadata
      )
      SELECT
        m.organization_id,
        'user',
        ${userId}::uuid,
        ${action},
        'user',
        ${userId},
        ${metadata ? this.database.sql.json(metadata as never) : null}
      FROM memberships m
      WHERE m.user_id = ${userId}::uuid
    `;
  }
}

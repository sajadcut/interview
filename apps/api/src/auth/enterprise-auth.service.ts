import { HttpException, Injectable, UnauthorizedException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { ACCOUNT_SECURITY_POLICY } from "./enterprise-auth.constants";
import { PasswordHasherService } from "./password-hasher.service";
import { SessionService, type IssuedSession, type SessionMetadata } from "./session.service";

export interface LoginResult extends IssuedSession {
  email: string;
  displayName: string | null;
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

@Injectable()
export class EnterpriseAuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly passwordHasher: PasswordHasherService,
    private readonly sessions: SessionService,
  ) {}

  async login(email: string, password: string, metadata: SessionMetadata = {}): Promise<LoginResult> {
    const normalizedEmail = normalizeEmail(email);
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
    if (row.disabled_at != null) {
      throw new UnauthorizedException("Account is disabled");
    }

    const userId = row.user_id;
    const lockedUntil = row.locked_until == null ? undefined : new Date(String(row.locked_until));
    if (lockedUntil && !Number.isNaN(lockedUntil.getTime()) && lockedUntil.getTime() > Date.now()) {
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

    const issued = await this.sessions.createInternalSession(userId, metadata);
    return {
      ...issued,
      email: typeof row.email === "string" ? row.email : normalizedEmail,
      displayName: typeof row.display_name === "string" ? row.display_name : null,
    };
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
}

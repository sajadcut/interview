import { Injectable, UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { DatabaseService } from "../database/database.service";
import { SESSION_POLICY, sessionMaxAgeMs } from "./session-policy";

export interface SessionMetadata {
  ip?: string;
  userAgent?: string;
}

export interface IssuedSession {
  userId: string;
  sessionId: string;
  sessionToken: string;
  refreshToken: string;
  sessionExpiresAt: Date;
  refreshExpiresAt: Date;
}

export interface ResolvedInternalSession {
  userId: string;
  sessionId: string;
}

function tokenHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function metadataHash(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  return tokenHash(value.trim());
}

function secureToken(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

@Injectable()
export class SessionService {
  constructor(private readonly database: DatabaseService) {}

  async createInternalSession(userId: string, metadata: SessionMetadata = {}): Promise<IssuedSession> {
    const sessionId = randomUUID();
    const refreshId = randomUUID();
    const familyId = randomUUID();
    const sessionToken = secureToken(32);
    const refreshToken = secureToken(48);
    const now = Date.now();
    const sessionExpiresAt = new Date(now + sessionMaxAgeMs(SESSION_POLICY.internalUserDays));
    const refreshExpiresAt = new Date(now + sessionMaxAgeMs(SESSION_POLICY.refreshTokenDays));

    await this.database.sql.begin(async (tx) => {
      await tx`
        INSERT INTO sessions (
          id, principal_type, user_id, token_hash, user_agent_hash, ip_hash, expires_at
        ) VALUES (
          ${sessionId}::uuid,
          'internal',
          ${userId}::uuid,
          ${tokenHash(sessionToken)},
          ${metadataHash(metadata.userAgent)},
          ${metadataHash(metadata.ip)},
          ${sessionExpiresAt}
        )
      `;
      await tx`
        INSERT INTO refresh_tokens (id, session_id, family_id, token_hash, expires_at)
        VALUES (
          ${refreshId}::uuid,
          ${sessionId}::uuid,
          ${familyId}::uuid,
          ${tokenHash(refreshToken)},
          ${refreshExpiresAt}
        )
      `;
    });

    return {
      userId,
      sessionId,
      sessionToken,
      refreshToken,
      sessionExpiresAt,
      refreshExpiresAt,
    };
  }

  async resolveInternalSession(rawToken: string): Promise<ResolvedInternalSession | undefined> {
    if (!rawToken) return undefined;
    const rows = await this.database.sql`
      SELECT s.id::text AS session_id, s.user_id::text AS user_id
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ${tokenHash(rawToken)}
        AND s.principal_type = 'internal'
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
        AND u.disabled_at IS NULL
      LIMIT 1
    `;
    const row = rows[0] as { session_id?: unknown; user_id?: unknown } | undefined;
    if (!row || typeof row.session_id !== "string" || typeof row.user_id !== "string") {
      return undefined;
    }
    return { sessionId: row.session_id, userId: row.user_id };
  }

  async rotateRefreshToken(rawRefreshToken: string, metadata: SessionMetadata = {}): Promise<IssuedSession> {
    if (!rawRefreshToken) throw new UnauthorizedException("Refresh token is required");
    const existingHash = tokenHash(rawRefreshToken);

    const result = await this.database.sql.begin(async (tx) => {
      const rows = await tx`
        SELECT
          rt.id::text AS refresh_id,
          rt.session_id::text AS session_id,
          rt.family_id::text AS family_id,
          rt.expires_at,
          rt.revoked_at,
          rt.rotated_to_id,
          s.user_id::text AS user_id,
          s.revoked_at AS session_revoked_at,
          u.disabled_at
        FROM refresh_tokens rt
        JOIN sessions s ON s.id = rt.session_id
        JOIN users u ON u.id = s.user_id
        WHERE rt.token_hash = ${existingHash}
        LIMIT 1
        FOR UPDATE OF rt, s
      `;
      const row = rows[0] as Record<string, unknown> | undefined;
      if (!row || typeof row.refresh_id !== "string" || typeof row.session_id !== "string") {
        return { kind: "invalid" as const };
      }

      const familyId = String(row.family_id);
      const sessionId = String(row.session_id);
      const userId = String(row.user_id);
      const refreshExpiresAtValue = row.expires_at;
      const refreshExpiresAt =
        refreshExpiresAtValue instanceof Date ? refreshExpiresAtValue : new Date(String(refreshExpiresAtValue));
      const reused = row.revoked_at != null || row.rotated_to_id != null;

      if (reused) {
        await tx`
          UPDATE refresh_tokens
          SET revoked_at = COALESCE(revoked_at, now())
          WHERE family_id = ${familyId}::uuid
        `;
        await tx`
          UPDATE sessions SET revoked_at = COALESCE(revoked_at, now())
          WHERE id = ${sessionId}::uuid
        `;
        return { kind: "reused" as const };
      }

      if (
        Number.isNaN(refreshExpiresAt.getTime()) ||
        refreshExpiresAt.getTime() <= Date.now() ||
        row.session_revoked_at != null ||
        row.disabled_at != null
      ) {
        return { kind: "invalid" as const };
      }

      const nextRefreshId = randomUUID();
      const nextSessionToken = secureToken(32);
      const nextRefreshToken = secureToken(48);
      const now = Date.now();
      const sessionExpiresAt = new Date(now + sessionMaxAgeMs(SESSION_POLICY.internalUserDays));
      const nextRefreshExpiresAt = new Date(now + sessionMaxAgeMs(SESSION_POLICY.refreshTokenDays));

      await tx`
        INSERT INTO refresh_tokens (id, session_id, family_id, token_hash, expires_at)
        VALUES (
          ${nextRefreshId}::uuid,
          ${sessionId}::uuid,
          ${familyId}::uuid,
          ${tokenHash(nextRefreshToken)},
          ${nextRefreshExpiresAt}
        )
      `;
      await tx`
        UPDATE refresh_tokens
        SET revoked_at = now(), rotated_to_id = ${nextRefreshId}::uuid
        WHERE id = ${String(row.refresh_id)}::uuid
      `;
      await tx`
        UPDATE sessions
        SET token_hash = ${tokenHash(nextSessionToken)},
            expires_at = ${sessionExpiresAt},
            last_seen_at = now(),
            user_agent_hash = COALESCE(${metadataHash(metadata.userAgent)}, user_agent_hash),
            ip_hash = COALESCE(${metadataHash(metadata.ip)}, ip_hash)
        WHERE id = ${sessionId}::uuid
      `;

      return {
        kind: "issued" as const,
        value: {
          userId,
          sessionId,
          sessionToken: nextSessionToken,
          refreshToken: nextRefreshToken,
          sessionExpiresAt,
          refreshExpiresAt: nextRefreshExpiresAt,
        } satisfies IssuedSession,
      };
    });

    if (result.kind === "reused") {
      throw new UnauthorizedException("Refresh token reuse detected; session revoked");
    }
    if (result.kind !== "issued") {
      throw new UnauthorizedException("Refresh token is invalid or expired");
    }
    return result.value;
  }

  async revoke(sessionToken?: string, refreshToken?: string): Promise<void> {
    if (sessionToken) {
      const sessionHash = tokenHash(sessionToken);
      await this.database.sql.begin(async (tx) => {
        const rows = await tx`
          UPDATE sessions
          SET revoked_at = COALESCE(revoked_at, now())
          WHERE token_hash = ${sessionHash}
          RETURNING id::text AS session_id
        `;
        const sessionId = (rows[0] as { session_id?: unknown } | undefined)?.session_id;
        if (typeof sessionId === "string") {
          await tx`
            UPDATE refresh_tokens
            SET revoked_at = COALESCE(revoked_at, now())
            WHERE session_id = ${sessionId}::uuid
          `;
        }
      });
      return;
    }

    if (refreshToken) {
      const refreshHash = tokenHash(refreshToken);
      await this.database.sql.begin(async (tx) => {
        const rows = await tx`
          UPDATE refresh_tokens
          SET revoked_at = COALESCE(revoked_at, now())
          WHERE token_hash = ${refreshHash}
          RETURNING session_id::text AS session_id
        `;
        const sessionId = (rows[0] as { session_id?: unknown } | undefined)?.session_id;
        if (typeof sessionId === "string") {
          await tx`
            UPDATE sessions
            SET revoked_at = COALESCE(revoked_at, now())
            WHERE id = ${sessionId}::uuid
          `;
          await tx`
            UPDATE refresh_tokens
            SET revoked_at = COALESCE(revoked_at, now())
            WHERE session_id = ${sessionId}::uuid
          `;
        }
      });
    }
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.database.sql.begin(async (tx) => {
      const rows = await tx`
        UPDATE sessions
        SET revoked_at = COALESCE(revoked_at, now())
        WHERE user_id = ${userId}::uuid
          AND revoked_at IS NULL
        RETURNING id::text AS session_id
      `;
      const sessionIds = rows
        .map((row) => (row as { session_id?: unknown }).session_id)
        .filter((value): value is string => typeof value === "string");
      if (sessionIds.length > 0) {
        await tx`
          UPDATE refresh_tokens
          SET revoked_at = COALESCE(revoked_at, now())
          WHERE session_id = ANY(${sessionIds}::uuid[])
        `;
      }
    });
  }
}

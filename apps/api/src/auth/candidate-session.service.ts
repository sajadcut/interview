import { Injectable, UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { DatabaseService } from "../database/database.service";
import { SESSION_POLICY } from "./session-policy";

export const CANDIDATE_SESSION_COOKIE = "interview_candidate_session";

export interface IssuedCandidateSession {
  sessionId: string;
  sessionToken: string;
  expiresAt: Date;
  organizationId: string;
  candidateId: string;
  candidateIdentityId: string;
  applicationId: string;
}

export interface ResolvedCandidateSession {
  sessionId: string;
  expiresAt: Date;
  organizationId: string;
  candidateId: string;
  candidateIdentityId: string;
  applicationId: string;
}

function tokenHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

@Injectable()
export class CandidateSessionService {
  constructor(private readonly database: DatabaseService) {}

  async create(input: {
    organizationId: string;
    candidateId: string;
    candidateIdentityId: string;
    applicationId: string;
    consumeInvitationIds?: string[];
  }): Promise<IssuedCandidateSession> {
    const sessionId = randomUUID();
    const sessionToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + SESSION_POLICY.candidateHours * 60 * 60 * 1000);

    await this.database.sql.begin(async (tx) => {
      if (input.consumeInvitationIds?.length) {
        const consumed = await tx`
          UPDATE invitation_tokens
          SET consumed_at = now()
          WHERE id = ANY(${input.consumeInvitationIds}::uuid[])
            AND organization_id = ${input.organizationId}::uuid
            AND candidate_identity_id = ${input.candidateIdentityId}::uuid
            AND consumed_at IS NULL
            AND expires_at > now()
          RETURNING id::text
        `;
        if (consumed.length !== input.consumeInvitationIds.length) {
          throw new UnauthorizedException("Candidate invitation is already used or expired");
        }
      }

      await tx`
        UPDATE candidate_identities
        SET is_verified = true,
            verified_at = now(),
            expires_at = ${expiresAt},
            temporary = true
        WHERE organization_id = ${input.organizationId}::uuid
          AND id = ${input.candidateIdentityId}::uuid
          AND candidate_id = ${input.candidateId}::uuid
      `;
      await tx`
        INSERT INTO sessions (
          id, principal_type, organization_id, candidate_identity_id, token_hash, expires_at
        ) VALUES (
          ${sessionId}::uuid,
          'candidate',
          ${input.organizationId}::uuid,
          ${input.candidateIdentityId}::uuid,
          ${tokenHash(sessionToken)},
          ${expiresAt}
        )
      `;
      await tx`
        INSERT INTO candidate_session_contexts (
          session_id, organization_id, application_id, candidate_id
        ) VALUES (
          ${sessionId}::uuid,
          ${input.organizationId}::uuid,
          ${input.applicationId}::uuid,
          ${input.candidateId}::uuid
        )
      `;
    });

    return {
      sessionId,
      sessionToken,
      expiresAt,
      organizationId: input.organizationId,
      candidateId: input.candidateId,
      candidateIdentityId: input.candidateIdentityId,
      applicationId: input.applicationId,
    };
  }

  /**
   * Compatibility entry point for callers that have already consumed the invitation
   * within their own transaction. New flows should prefer create() and pass
   * consumeInvitationIds so invitation consumption and session creation are atomic.
   */
  issue(input: {
    organizationId: string;
    candidateId: string;
    candidateIdentityId: string;
    applicationId: string;
  }): Promise<IssuedCandidateSession> {
    return this.create(input);
  }

  async resolve(rawToken: string | undefined): Promise<ResolvedCandidateSession | undefined> {
    if (!rawToken) return undefined;
    const rows = await this.database.sql`
      SELECT
        s.id::text AS session_id,
        s.expires_at,
        s.organization_id::text,
        s.candidate_identity_id::text,
        csc.candidate_id::text,
        csc.application_id::text
      FROM sessions s
      JOIN candidate_session_contexts csc
        ON csc.session_id = s.id AND csc.organization_id = s.organization_id
      JOIN candidate_identities ci
        ON ci.id = s.candidate_identity_id AND ci.organization_id = s.organization_id
      JOIN applications a
        ON a.id = csc.application_id
       AND a.organization_id = csc.organization_id
       AND a.candidate_id = csc.candidate_id
      WHERE s.principal_type = 'candidate'
        AND s.token_hash = ${tokenHash(rawToken)}
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
        AND ci.is_verified = true
        AND (ci.expires_at IS NULL OR ci.expires_at > now())
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return undefined;
    return {
      sessionId: String(row.session_id),
      expiresAt: new Date(String(row.expires_at)),
      organizationId: String(row.organization_id),
      candidateIdentityId: String(row.candidate_identity_id),
      candidateId: String(row.candidate_id),
      applicationId: String(row.application_id),
    };
  }

  async revoke(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    await this.database.sql`
      UPDATE sessions
      SET revoked_at = COALESCE(revoked_at, now())
      WHERE principal_type = 'candidate'
        AND token_hash = ${tokenHash(rawToken)}
    `;
  }
}

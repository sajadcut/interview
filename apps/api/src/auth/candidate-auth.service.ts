import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import { getEnv } from "../config/env";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import type { CreateCandidateInvitationDto } from "./dto/candidate-auth.dto";
import {
  AUTH_RATE_LIMIT_POLICIES,
  AuthRateLimitService,
} from "./security/auth-rate-limit.service";
import { CandidateSessionService } from "./candidate-session.service";

const CANDIDATE_INVITATION_HOURS = 48;
const CANDIDATE_OTP_MAX_ATTEMPTS = 5;

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function otpHash(magicToken: string, otp: string): string {
  return hash(`${magicToken}:${otp}`);
}

function secureEqual(leftHex: string, rightHex: string): boolean {
  try {
    const left = Buffer.from(leftHex, "hex");
    const right = Buffer.from(rightHex, "hex");
    return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  if (!domain) return "***";
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}

@Injectable()
export class CandidateAuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
    private readonly rateLimits: AuthRateLimitService,
    private readonly candidateSessions: CandidateSessionService,
  ) {}

  async createInvitation(input: CreateCandidateInvitationDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      SELECT
        a.id::text AS application_id,
        c.id::text AS candidate_id,
        c.primary_email,
        c.display_name,
        j.title AS job_title
      FROM applications a
      JOIN candidates c
        ON c.organization_id = a.organization_id AND c.id = a.candidate_id
      JOIN jobs j
        ON j.organization_id = a.organization_id AND j.id = a.job_id
      WHERE a.organization_id = ${organizationId}::uuid
        AND a.id = ${input.applicationId}::uuid
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) throw new NotFoundException("Candidate application was not found");
    if (!row.primary_email) {
      throw new BadRequestException("Candidate must have an email before an invitation can be created");
    }

    const candidateId = String(row.candidate_id);
    const applicationId = String(row.application_id);
    const email = normalizeEmail(String(row.primary_email));
    const magicToken = randomBytes(32).toString("base64url");
    const otp = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const otpLocatorToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + CANDIDATE_INVITATION_HOURS * 60 * 60 * 1000);

    const result = await this.database.sql.begin(async (tx) => {
      const identityRows = await tx`
        INSERT INTO candidate_identities (
          organization_id,
          candidate_id,
          identity_type,
          normalized_value,
          is_verified,
          verified_at,
          expires_at,
          temporary
        ) VALUES (
          ${organizationId}::uuid,
          ${candidateId}::uuid,
          'candidate_portal_email',
          ${email},
          false,
          NULL,
          ${expiresAt},
          true
        )
        ON CONFLICT (organization_id, identity_type, normalized_value)
        DO UPDATE SET
          candidate_id = EXCLUDED.candidate_id,
          is_verified = false,
          verified_at = NULL,
          expires_at = EXCLUDED.expires_at,
          temporary = true
        RETURNING id::text
      `;
      const candidateIdentityId = String(identityRows[0]?.id);

      await tx`
        UPDATE invitation_tokens it
        SET consumed_at = COALESCE(consumed_at, now())
        FROM candidate_invitation_contexts cic
        WHERE cic.invitation_token_id = it.id
          AND cic.organization_id = ${organizationId}::uuid
          AND cic.application_id = ${applicationId}::uuid
          AND it.candidate_identity_id = ${candidateIdentityId}::uuid
          AND it.purpose IN ('candidate_magic_link', 'candidate_otp')
          AND it.consumed_at IS NULL
      `;

      const magicRows = await tx`
        INSERT INTO invitation_tokens (
          organization_id,
          candidate_identity_id,
          target_email,
          purpose,
          token_hash,
          expires_at
        ) VALUES (
          ${organizationId}::uuid,
          ${candidateIdentityId}::uuid,
          ${email},
          'candidate_magic_link',
          ${hash(magicToken)},
          ${expiresAt}
        )
        RETURNING id::text
      `;
      const magicInvitationId = String(magicRows[0]?.id);
      await tx`
        INSERT INTO candidate_invitation_contexts (
          invitation_token_id, organization_id, application_id, candidate_id
        ) VALUES (
          ${magicInvitationId}::uuid,
          ${organizationId}::uuid,
          ${applicationId}::uuid,
          ${candidateId}::uuid
        )
      `;

      const otpRows = await tx`
        INSERT INTO invitation_tokens (
          organization_id,
          candidate_identity_id,
          target_email,
          purpose,
          token_hash,
          otp_hash,
          expires_at
        ) VALUES (
          ${organizationId}::uuid,
          ${candidateIdentityId}::uuid,
          ${email},
          'candidate_otp',
          ${hash(otpLocatorToken)},
          ${otpHash(magicToken, otp)},
          ${expiresAt}
        )
        RETURNING id::text
      `;
      const otpChallengeId = String(otpRows[0]?.id);
      await tx`
        INSERT INTO candidate_invitation_contexts (
          invitation_token_id, organization_id, application_id, candidate_id
        ) VALUES (
          ${otpChallengeId}::uuid,
          ${organizationId}::uuid,
          ${applicationId}::uuid,
          ${candidateId}::uuid
        )
      `;

      return { candidateIdentityId, magicInvitationId, otpChallengeId };
    });

    await this.audit.record({
      action: "candidate.invitation.create",
      entityType: "application",
      entityId: applicationId,
      metadata: {
        candidateId,
        invitationId: result.magicInvitationId,
        expiresAt: expiresAt.toISOString(),
      },
    });

    return {
      invitationId: result.magicInvitationId,
      otpChallengeId: result.otpChallengeId,
      maskedEmail: maskEmail(email),
      expiresAt: expiresAt.toISOString(),
      deliveryRequired: true,
      candidate: {
        displayName: String(row.display_name),
        jobTitle: String(row.job_title),
      },
      ...(getEnv().NODE_ENV !== "production"
        ? { developmentToken: magicToken, developmentOtp: otp }
        : {}),
    };
  }

  async validateMagicLink(rawToken: string) {
    const rows = await this.database.sql`
      SELECT
        it.id::text AS invitation_id,
        it.organization_id::text,
        it.candidate_identity_id::text,
        it.target_email,
        it.expires_at,
        cic.application_id::text,
        cic.candidate_id::text,
        c.display_name,
        j.title AS job_title
      FROM invitation_tokens it
      JOIN candidate_invitation_contexts cic ON cic.invitation_token_id = it.id
      JOIN candidates c
        ON c.organization_id = cic.organization_id AND c.id = cic.candidate_id
      JOIN applications a
        ON a.organization_id = cic.organization_id AND a.id = cic.application_id
      JOIN jobs j
        ON j.organization_id = a.organization_id AND j.id = a.job_id
      WHERE it.token_hash = ${hash(rawToken)}
        AND it.purpose = 'candidate_magic_link'
        AND it.consumed_at IS NULL
        AND it.expires_at > now()
        AND (it.locked_until IS NULL OR it.locked_until <= now())
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) throw new UnauthorizedException("Candidate invitation is invalid or expired");
    return {
      valid: true,
      invitationId: String(row.invitation_id),
      applicationId: String(row.application_id),
      maskedEmail: maskEmail(String(row.target_email)),
      candidateDisplayName: String(row.display_name),
      jobTitle: String(row.job_title),
      expiresAt: new Date(String(row.expires_at)).toISOString(),
      otpRequired: true,
    };
  }

  async verifyOtp(rawToken: string, otp: string) {
    await this.rateLimits.consume("candidate-otp", rawToken, AUTH_RATE_LIMIT_POLICIES.candidateOtp);
    const magicRows = await this.database.sql`
      SELECT
        it.id::text AS magic_id,
        it.organization_id::text,
        it.candidate_identity_id::text,
        cic.application_id::text,
        cic.candidate_id::text
      FROM invitation_tokens it
      JOIN candidate_invitation_contexts cic ON cic.invitation_token_id = it.id
      WHERE it.token_hash = ${hash(rawToken)}
        AND it.purpose = 'candidate_magic_link'
        AND it.consumed_at IS NULL
        AND it.expires_at > now()
        AND (it.locked_until IS NULL OR it.locked_until <= now())
      LIMIT 1
    `;
    const magic = magicRows[0];
    if (!magic) throw new UnauthorizedException("Candidate invitation is invalid or expired");

    const otpRows = await this.database.sql`
      SELECT it.id::text AS otp_id, it.otp_hash, it.failed_attempts, it.locked_until
      FROM invitation_tokens it
      JOIN candidate_invitation_contexts cic ON cic.invitation_token_id = it.id
      WHERE it.organization_id = ${String(magic.organization_id)}::uuid
        AND it.candidate_identity_id = ${String(magic.candidate_identity_id)}::uuid
        AND it.purpose = 'candidate_otp'
        AND it.consumed_at IS NULL
        AND it.expires_at > now()
        AND cic.application_id = ${String(magic.application_id)}::uuid
      ORDER BY it.created_at DESC
      LIMIT 1
    `;
    const challenge = otpRows[0];
    if (!challenge || typeof challenge.otp_hash !== "string") {
      throw new UnauthorizedException("Candidate verification challenge is invalid or expired");
    }
    const lockedUntil = challenge.locked_until ? new Date(String(challenge.locked_until)) : null;
    if (lockedUntil && lockedUntil.getTime() > Date.now()) {
      throw new UnauthorizedException("Candidate verification challenge is temporarily locked");
    }

    const valid = secureEqual(challenge.otp_hash, otpHash(rawToken, otp));
    if (!valid) {
      await this.database.sql`
        UPDATE invitation_tokens
        SET failed_attempts = failed_attempts + 1,
            locked_until = CASE
              WHEN failed_attempts + 1 >= ${CANDIDATE_OTP_MAX_ATTEMPTS}
                THEN now() + interval '30 minutes'
              ELSE locked_until
            END
        WHERE id = ${String(challenge.otp_id)}::uuid
      `;
      throw new UnauthorizedException("Verification code is invalid");
    }

    await this.rateLimits.clear("candidate-otp", rawToken);
    const issued = await this.candidateSessions.create({
      organizationId: String(magic.organization_id),
      candidateIdentityId: String(magic.candidate_identity_id),
      candidateId: String(magic.candidate_id),
      applicationId: String(magic.application_id),
      consumeInvitationIds: [String(magic.magic_id), String(challenge.otp_id)],
    });

    await this.database.sql`
      INSERT INTO audit_events (
        organization_id, actor_type, action, entity_type, entity_id, metadata
      ) VALUES (
        ${issued.organizationId}::uuid,
        'candidate',
        'candidate.auth.verified',
        'application',
        ${issued.applicationId},
        ${this.database.sql.json({ sessionId: issued.sessionId, candidateId: issued.candidateId } as never)}
      )
    `;

    return issued;
  }

  async getSession(rawToken: string | undefined) {
    const session = await this.candidateSessions.resolve(rawToken);
    if (!session) throw new UnauthorizedException("Candidate authentication is required");
    const rows = await this.database.sql`
      SELECT c.display_name, j.title AS job_title, a.status, a.pipeline_stage
      FROM applications a
      JOIN candidates c
        ON c.organization_id = a.organization_id AND c.id = a.candidate_id
      JOIN jobs j
        ON j.organization_id = a.organization_id AND j.id = a.job_id
      WHERE a.organization_id = ${session.organizationId}::uuid
        AND a.id = ${session.applicationId}::uuid
        AND a.candidate_id = ${session.candidateId}::uuid
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) throw new UnauthorizedException("Candidate application is no longer available");
    return {
      ...session,
      candidateDisplayName: String(row.display_name),
      jobTitle: String(row.job_title),
      applicationStatus: String(row.status),
      pipelineStage: String(row.pipeline_stage),
    };
  }

  async logout(rawToken: string | undefined): Promise<void> {
    await this.candidateSessions.revoke(rawToken);
  }
}

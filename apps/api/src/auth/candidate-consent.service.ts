import { Injectable, UnauthorizedException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { CandidateSessionService } from "./candidate-session.service";
import {
  CandidateConsentTypes,
  type CandidateConsentType,
  type RecordCandidateConsentDto,
} from "./dto/candidate-consent.dto";

const REQUIRED_CONSENTS = new Set<CandidateConsentType>(CandidateConsentTypes);

@Injectable()
export class CandidateConsentService {
  constructor(
    private readonly database: DatabaseService,
    private readonly candidateSessions: CandidateSessionService,
  ) {}

  private async scope(rawToken: string | undefined) {
    const scope = await this.candidateSessions.resolve(rawToken);
    if (!scope) throw new UnauthorizedException("Candidate session is required");
    return scope;
  }

  async record(rawToken: string | undefined, input: RecordCandidateConsentDto) {
    const scope = await this.scope(rawToken);
    const rows = await this.database.sql`
      INSERT INTO candidate_consent_receipts (
        organization_id, candidate_identity_id, candidate_id, application_id,
        consent_type, notice_version, granted, granted_at, withdrawn_at, metadata
      ) VALUES (
        ${scope.organizationId}::uuid,
        ${scope.candidateIdentityId}::uuid,
        ${scope.candidateId}::uuid,
        ${scope.applicationId}::uuid,
        ${input.consentType},
        ${input.noticeVersion.trim()},
        ${input.granted},
        ${input.granted ? new Date() : null},
        ${input.granted ? null : new Date()},
        ${this.database.sql.json({ sessionId: scope.sessionId } as never)}
      )
      RETURNING id::text, consent_type, notice_version, granted, created_at
    `;
    const row = rows[0];
    return {
      id: String(row?.id),
      consentType: String(row?.consent_type) as CandidateConsentType,
      noticeVersion: String(row?.notice_version),
      granted: Boolean(row?.granted),
      createdAt: new Date(String(row?.created_at)).toISOString(),
    };
  }

  async status(rawToken: string | undefined) {
    const scope = await this.scope(rawToken);
    const rows = await this.database.sql`
      SELECT DISTINCT ON (consent_type)
        id::text, consent_type, notice_version, granted, created_at
      FROM candidate_consent_receipts
      WHERE organization_id = ${scope.organizationId}::uuid
        AND candidate_identity_id = ${scope.candidateIdentityId}::uuid
        AND candidate_id = ${scope.candidateId}::uuid
        AND application_id = ${scope.applicationId}::uuid
      ORDER BY consent_type, created_at DESC
    `;
    const latest = rows.map((row) => ({
      id: String(row.id),
      consentType: String(row.consent_type) as CandidateConsentType,
      noticeVersion: String(row.notice_version),
      granted: Boolean(row.granted),
      createdAt: new Date(String(row.created_at)).toISOString(),
    }));
    const granted = new Set(
      latest.filter((receipt) => receipt.granted).map((receipt) => receipt.consentType),
    );
    const missingRequiredConsents = [...REQUIRED_CONSENTS].filter((type) => !granted.has(type));
    return {
      latest,
      readyForInterview: missingRequiredConsents.length === 0,
      missingRequiredConsents,
    };
  }
}

import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";

@Injectable()
export class AssessmentsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async createSession(assessmentId: string, body: unknown) {
    if (!body || typeof body !== "object") throw new Error("Assessment session input is required");
    const value = body as Record<string, unknown>;
    if (typeof value.applicationId !== "string") throw new Error("applicationId is required");
    const candidateNoticeVersion =
      typeof value.candidateNoticeVersion === "string" ? value.candidateNoticeVersion : null;

    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      INSERT INTO assessment_sessions (
        organization_id,
        assessment_id,
        application_id,
        status,
        candidate_notice_version
      ) VALUES (
        ${organizationId}::uuid,
        ${assessmentId}::uuid,
        ${value.applicationId}::uuid,
        'invited',
        ${candidateNoticeVersion}
      )
      RETURNING id, assessment_id, application_id, status, candidate_notice_version, created_at
    `;
    return rows[0];
  }

  async listForApplication(applicationId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      SELECT
        s.id AS session_id,
        s.status AS session_status,
        s.started_at,
        s.submitted_at,
        s.expires_at,
        s.integrity_signals,
        a.id AS assessment_id,
        a.assessment_type,
        a.title,
        a.version,
        r.id AS result_id,
        r.status AS result_status,
        r.passed_tests,
        r.total_tests,
        r.normalized_score,
        r.runner_type,
        r.runner_version,
        r.details
      FROM assessment_sessions s
      JOIN assessments a
        ON a.organization_id = s.organization_id AND a.id = s.assessment_id
      LEFT JOIN assessment_results r
        ON r.organization_id = s.organization_id AND r.assessment_session_id = s.id
      WHERE s.organization_id = ${organizationId}::uuid
        AND s.application_id = ${applicationId}::uuid
      ORDER BY s.created_at DESC, r.created_at DESC
    `;

    return {
      applicationId,
      sessions: rows,
      safetyNotice:
        "Candidate code executes only through an isolated AssessmentRunner. Integrity signals are review aids, not automatic misconduct findings.",
    };
  }
}

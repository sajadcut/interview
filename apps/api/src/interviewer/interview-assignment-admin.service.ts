import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";

@Injectable()
export class InterviewAssignmentAdminService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async getOptions() {
    const organizationId = this.tenantContext.require().organizationId;
    const [sessions, interviewers] = await Promise.all([
      this.database.sql`
        SELECT
          s.id::text AS session_id,
          s.status AS session_status,
          s.created_at,
          a.id::text AS application_id,
          c.display_name AS candidate_name,
          j.title AS job_title,
          ia.interviewer_user_id::text,
          iu.display_name AS interviewer_name,
          iu.email AS interviewer_email,
          ia.status AS assignment_status,
          ia.scheduled_for
        FROM interview_sessions s
        JOIN applications a
          ON a.organization_id = s.organization_id AND a.id = s.application_id
        JOIN candidates c
          ON c.organization_id = a.organization_id AND c.id = a.candidate_id
        JOIN jobs j
          ON j.organization_id = a.organization_id AND j.id = a.job_id
        LEFT JOIN interview_assignments ia
          ON ia.organization_id = s.organization_id
         AND ia.interview_session_id = s.id
         AND ia.status <> 'cancelled'
        LEFT JOIN users iu ON iu.id = ia.interviewer_user_id
        WHERE s.organization_id = ${organizationId}::uuid
          AND s.status NOT IN ('cancelled')
        ORDER BY COALESCE(ia.scheduled_for, s.created_at) DESC
      `,
      this.database.sql`
        SELECT DISTINCT
          u.id::text AS user_id,
          u.email,
          u.display_name
        FROM memberships m
        JOIN users u ON u.id = m.user_id
        JOIN membership_roles mr
          ON mr.membership_id = m.id AND mr.organization_id = m.organization_id
        JOIN roles r
          ON r.id = mr.role_id AND r.organization_id = m.organization_id
        WHERE m.organization_id = ${organizationId}::uuid
          AND m.status = 'active'
          AND u.disabled_at IS NULL
          AND r.key = 'INTERVIEWER'
        ORDER BY lower(u.email)
      `,
    ]);

    return {
      sessions: sessions.map((row) => ({
        sessionId: String(row.session_id),
        sessionStatus: String(row.session_status),
        applicationId: String(row.application_id),
        candidateName: String(row.candidate_name),
        jobTitle: String(row.job_title),
        ...(row.interviewer_user_id ? { interviewerUserId: String(row.interviewer_user_id) } : {}),
        ...(row.interviewer_name ? { interviewerName: String(row.interviewer_name) } : {}),
        ...(row.interviewer_email ? { interviewerEmail: String(row.interviewer_email) } : {}),
        ...(row.assignment_status ? { assignmentStatus: String(row.assignment_status) } : {}),
        ...(row.scheduled_for ? { scheduledFor: new Date(String(row.scheduled_for)).toISOString() } : {}),
      })),
      interviewers: interviewers.map((row) => ({
        userId: String(row.user_id),
        email: String(row.email),
        ...(row.display_name ? { displayName: String(row.display_name) } : {}),
      })),
    };
  }
}

import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AuthContextService } from "../auth/auth-context.service";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import type {
  CreateHiringRequestDto,
  LinkHiringRequestJobDto,
  ReviewHiringRequestDto,
  SubmitTechnicalApprovalDto,
} from "./hiring-requests.dto";

function actorId(auth: AuthContextService): string {
  const userId = auth.getOptional()?.userId;
  if (!userId) throw new BadRequestException("Authenticated user context is required");
  return userId;
}

@Injectable()
export class HiringRequestsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
    private readonly authContext: AuthContextService,
  ) {}

  async listHiringRequests() {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      SELECT
        hr.id::text, hr.title, hr.hiring_team, hr.department, hr.headcount, hr.seniority,
        hr.location, hr.employment_type, hr.business_reason, hr.requirements, hr.status,
        hr.requester_user_id::text, requester.display_name AS requester_name, requester.email AS requester_email,
        hr.hr_owner_user_id::text, owner.display_name AS hr_owner_name,
        hr.linked_job_id::text, j.title AS linked_job_title, hr.review_note,
        hr.submitted_at, hr.reviewed_at, hr.created_at, hr.updated_at,
        count(DISTINCT a.id)::int AS application_count,
        count(DISTINCT a.id) FILTER (WHERE a.pipeline_stage = 'hired')::int AS hired_count
      FROM hiring_requests hr
      JOIN users requester ON requester.id = hr.requester_user_id
      LEFT JOIN users owner ON owner.id = hr.hr_owner_user_id
      LEFT JOIN jobs j ON j.organization_id = hr.organization_id AND j.id = hr.linked_job_id
      LEFT JOIN applications a ON a.organization_id = hr.organization_id AND a.job_id = hr.linked_job_id
      WHERE hr.organization_id = ${organizationId}::uuid
      GROUP BY
        hr.id, hr.title, hr.hiring_team, hr.department, hr.headcount, hr.seniority,
        hr.location, hr.employment_type, hr.business_reason, hr.requirements, hr.status,
        hr.requester_user_id, requester.display_name, requester.email, hr.hr_owner_user_id,
        owner.display_name, hr.linked_job_id, j.title, hr.review_note, hr.submitted_at,
        hr.reviewed_at, hr.created_at, hr.updated_at
      ORDER BY hr.updated_at DESC, hr.created_at DESC
    `;
    return rows.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      hiringTeam: String(row.hiring_team),
      ...(row.department ? { department: String(row.department) } : {}),
      headcount: Number(row.headcount),
      ...(row.seniority ? { seniority: String(row.seniority) } : {}),
      ...(row.location ? { location: String(row.location) } : {}),
      ...(row.employment_type ? { employmentType: String(row.employment_type) } : {}),
      businessReason: String(row.business_reason),
      requirements: Array.isArray(row.requirements) ? row.requirements.map(String) : [],
      status: String(row.status),
      requesterUserId: String(row.requester_user_id),
      requesterName: String(row.requester_name || row.requester_email),
      ...(row.hr_owner_user_id ? { hrOwnerUserId: String(row.hr_owner_user_id) } : {}),
      ...(row.hr_owner_name ? { hrOwnerName: String(row.hr_owner_name) } : {}),
      ...(row.linked_job_id ? { linkedJobId: String(row.linked_job_id) } : {}),
      ...(row.linked_job_title ? { linkedJobTitle: String(row.linked_job_title) } : {}),
      ...(row.review_note ? { reviewNote: String(row.review_note) } : {}),
      applicationCount: Number(row.application_count ?? 0),
      hiredCount: Number(row.hired_count ?? 0),
      ...(row.submitted_at ? { submittedAt: new Date(String(row.submitted_at)).toISOString() } : {}),
      ...(row.reviewed_at ? { reviewedAt: new Date(String(row.reviewed_at)).toISOString() } : {}),
      createdAt: new Date(String(row.created_at)).toISOString(),
      updatedAt: new Date(String(row.updated_at)).toISOString(),
    }));
  }

  async createHiringRequest(input: CreateHiringRequestDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const userId = actorId(this.authContext);
    const requirements = input.requirements.map((value) => value.trim()).filter(Boolean);
    const rows = await this.database.sql`
      INSERT INTO hiring_requests (
        organization_id, title, hiring_team, department, headcount, seniority, location,
        employment_type, business_reason, requirements, requester_user_id
      ) VALUES (
        ${organizationId}::uuid, ${input.title.trim()}, ${input.hiringTeam.trim()},
        ${input.department?.trim() || null}, ${input.headcount}, ${input.seniority?.trim() || null},
        ${input.location?.trim() || null}, ${input.employmentType?.trim() || null},
        ${input.businessReason.trim()}, ${JSON.stringify(requirements)}::jsonb, ${userId}::uuid
      )
      RETURNING id::text, status, created_at
    `;
    return {
      id: String(rows[0]?.id),
      status: String(rows[0]?.status),
      createdAt: new Date(String(rows[0]?.created_at)).toISOString(),
    };
  }

  async submitHiringRequest(hiringRequestId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const userId = actorId(this.authContext);
    const rows = await this.database.sql`
      UPDATE hiring_requests
      SET status = 'submitted', submitted_at = now(), updated_at = now()
      WHERE organization_id = ${organizationId}::uuid
        AND id = ${hiringRequestId}::uuid
        AND requester_user_id = ${userId}::uuid
        AND status = 'draft'
      RETURNING id::text, status, submitted_at
    `;
    if (!rows[0]) throw new BadRequestException("Only the requester can submit a draft hiring request");
    return {
      id: String(rows[0].id),
      status: String(rows[0].status),
      submittedAt: new Date(String(rows[0].submitted_at)).toISOString(),
    };
  }

  async reviewHiringRequest(hiringRequestId: string, input: ReviewHiringRequestDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const userId = actorId(this.authContext);
    const status = input.decision === "approve" ? "approved" : "rejected";
    const rows = await this.database.sql`
      UPDATE hiring_requests
      SET status = ${status}, hr_owner_user_id = ${userId}::uuid,
          review_note = ${input.note.trim()}, reviewed_at = now(), updated_at = now()
      WHERE organization_id = ${organizationId}::uuid
        AND id = ${hiringRequestId}::uuid
        AND status = 'submitted'
      RETURNING id::text, status, reviewed_at
    `;
    if (!rows[0]) throw new BadRequestException("Only a submitted hiring request can be reviewed");
    return {
      id: String(rows[0].id),
      status: String(rows[0].status),
      note: input.note.trim(),
      reviewedAt: new Date(String(rows[0].reviewed_at)).toISOString(),
    };
  }

  async linkJob(hiringRequestId: string, input: LinkHiringRequestJobDto) {
    const organizationId = this.tenantContext.require().organizationId;
    return this.database.sql.begin(async (tx) => {
      const requests = await tx`
        SELECT id::text, status
        FROM hiring_requests
        WHERE organization_id = ${organizationId}::uuid AND id = ${hiringRequestId}::uuid
        LIMIT 1 FOR UPDATE
      `;
      if (!requests[0]) throw new NotFoundException("Hiring request not found");
      if (!["approved", "recruiting"].includes(String(requests[0].status))) {
        throw new BadRequestException("Hiring request must be approved before a job is linked");
      }
      const jobs = await tx`
        SELECT id::text, title FROM jobs
        WHERE organization_id = ${organizationId}::uuid AND id = ${input.jobId}::uuid
        LIMIT 1
      `;
      if (!jobs[0]) throw new NotFoundException("Job not found");
      await tx`
        UPDATE hiring_requests
        SET linked_job_id = ${input.jobId}::uuid, status = 'recruiting', updated_at = now()
        WHERE organization_id = ${organizationId}::uuid AND id = ${hiringRequestId}::uuid
      `;
      return { id: hiringRequestId, status: "recruiting", linkedJobId: input.jobId, linkedJobTitle: String(jobs[0].title) };
    });
  }

  async submitTechnicalApproval(applicationId: string, input: SubmitTechnicalApprovalDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const userId = actorId(this.authContext);
    return this.database.sql.begin(async (tx) => {
      const rows = await tx`
        SELECT a.id::text, a.pipeline_stage, hr.id::text AS hiring_request_id
        FROM applications a
        JOIN hiring_requests hr ON hr.organization_id = a.organization_id AND hr.linked_job_id = a.job_id
        WHERE a.organization_id = ${organizationId}::uuid AND a.id = ${applicationId}::uuid
        LIMIT 1 FOR UPDATE OF a
      `;
      const application = rows[0];
      if (!application) throw new BadRequestException("Application is not linked to a hiring request");

      const stage = input.decision === "approve"
        ? "technical_approved"
        : input.decision === "reject"
          ? "technical_rejected"
          : "technical_review";

      const approvals = await tx`
        INSERT INTO application_technical_approvals (
          organization_id, hiring_request_id, application_id, approver_user_id, decision, feedback
        ) VALUES (
          ${organizationId}::uuid, ${String(application.hiring_request_id)}::uuid,
          ${applicationId}::uuid, ${userId}::uuid, ${input.decision}, ${input.feedback.trim()}
        )
        RETURNING id::text, decision, feedback, created_at
      `;

      if (String(application.pipeline_stage) !== stage) {
        await tx`
          INSERT INTO application_stage_transitions (
            organization_id, application_id, from_stage, to_stage, reason, actor_user_id
          ) VALUES (
            ${organizationId}::uuid, ${applicationId}::uuid, ${String(application.pipeline_stage)},
            ${stage}, ${"Requesting-team technical approval: " + input.decision}, ${userId}::uuid
          )
        `;
        await tx`
          UPDATE applications SET pipeline_stage = ${stage}, updated_at = now()
          WHERE organization_id = ${organizationId}::uuid AND id = ${applicationId}::uuid
        `;
      }

      return {
        id: String(approvals[0]?.id),
        hiringRequestId: String(application.hiring_request_id),
        applicationId,
        decision: String(approvals[0]?.decision),
        feedback: String(approvals[0]?.feedback),
        pipelineStage: stage,
        createdAt: new Date(String(approvals[0]?.created_at)).toISOString(),
      };
    });
  }

  async getTechnicalApproval(applicationId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      SELECT ta.id::text, ta.hiring_request_id::text, ta.application_id::text,
             ta.approver_user_id::text, u.display_name AS approver_name, u.email AS approver_email,
             ta.decision, ta.feedback, ta.created_at
      FROM application_technical_approvals ta
      JOIN users u ON u.id = ta.approver_user_id
      WHERE ta.organization_id = ${organizationId}::uuid AND ta.application_id = ${applicationId}::uuid
      ORDER BY ta.created_at DESC, ta.id DESC LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;
    return {
      id: String(row.id),
      hiringRequestId: String(row.hiring_request_id),
      applicationId: String(row.application_id),
      approverUserId: String(row.approver_user_id),
      approverName: String(row.approver_name || row.approver_email),
      decision: String(row.decision),
      feedback: String(row.feedback),
      createdAt: new Date(String(row.created_at)).toISOString(),
    };
  }
}

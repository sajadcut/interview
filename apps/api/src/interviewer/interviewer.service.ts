import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import { AuthContextService } from "../auth/auth-context.service";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import type {
  AssignInterviewerDto,
  InterviewerNoteInputDto,
  SubmitInterviewerEvaluationDto,
} from "./interviewer.dto";

function asIso(value: unknown): string | undefined {
  if (value == null) return undefined;
  return new Date(String(value)).toISOString();
}

@Injectable()
export class InterviewerService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
    private readonly authContext: AuthContextService,
    private readonly audit: AuditService,
  ) {}

  async assign(input: AssignInterviewerDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const actorUserId = this.requireUserId();

    const sessionRows = await this.database.sql`
      SELECT id::text
      FROM interview_sessions
      WHERE organization_id = ${organizationId}::uuid
        AND id = ${input.sessionId}::uuid
      LIMIT 1
    `;
    if (!sessionRows[0]) throw new NotFoundException("Interview session was not found");

    const interviewerRows = await this.database.sql`
      SELECT m.id::text
      FROM memberships m
      JOIN membership_roles mr
        ON mr.membership_id = m.id AND mr.organization_id = m.organization_id
      JOIN roles r
        ON r.id = mr.role_id AND r.organization_id = m.organization_id
      WHERE m.organization_id = ${organizationId}::uuid
        AND m.user_id = ${input.interviewerUserId}::uuid
        AND m.status = 'active'
        AND r.key = 'INTERVIEWER'
      LIMIT 1
    `;
    if (!interviewerRows[0]) {
      throw new BadRequestException("Assigned user must be an active INTERVIEWER in this organization");
    }

    const rows = await this.database.sql`
      INSERT INTO interview_assignments (
        organization_id,
        interview_session_id,
        interviewer_user_id,
        assigned_by_user_id,
        status,
        scheduled_for
      ) VALUES (
        ${organizationId}::uuid,
        ${input.sessionId}::uuid,
        ${input.interviewerUserId}::uuid,
        ${actorUserId}::uuid,
        'assigned',
        ${input.scheduledFor ? new Date(input.scheduledFor) : null}
      )
      ON CONFLICT (organization_id, interview_session_id, interviewer_user_id)
      DO UPDATE SET
        assigned_by_user_id = EXCLUDED.assigned_by_user_id,
        status = 'assigned',
        scheduled_for = EXCLUDED.scheduled_for,
        updated_at = now()
      RETURNING id::text, status, scheduled_for, created_at, updated_at
    `;
    const row = rows[0];
    if (!row) throw new ConflictException("Unable to assign interviewer");

    await this.audit.record({
      action: "interview.interviewer.assign",
      entityType: "interview_session",
      entityId: input.sessionId,
      after: {
        interviewerUserId: input.interviewerUserId,
        scheduledFor: input.scheduledFor ?? null,
      },
    });

    return {
      id: String(row.id),
      sessionId: input.sessionId,
      interviewerUserId: input.interviewerUserId,
      status: String(row.status),
      ...(asIso(row.scheduled_for) ? { scheduledFor: asIso(row.scheduled_for) } : {}),
      createdAt: asIso(row.created_at),
      updatedAt: asIso(row.updated_at),
    };
  }

  async listMine() {
    const organizationId = this.tenantContext.require().organizationId;
    const userId = this.requireUserId();
    const rows = await this.database.sql`
      SELECT
        ia.id::text AS assignment_id,
        ia.status AS assignment_status,
        ia.scheduled_for,
        s.id::text AS session_id,
        s.status AS session_status,
        s.started_at,
        s.completed_at,
        a.id::text AS application_id,
        c.id::text AS candidate_id,
        c.display_name AS candidate_name,
        j.id::text AS job_id,
        j.title AS job_title
      FROM interview_assignments ia
      JOIN interview_sessions s
        ON s.organization_id = ia.organization_id
       AND s.id = ia.interview_session_id
      JOIN applications a
        ON a.organization_id = s.organization_id
       AND a.id = s.application_id
      JOIN candidates c
        ON c.organization_id = a.organization_id
       AND c.id = a.candidate_id
      JOIN jobs j
        ON j.organization_id = a.organization_id
       AND j.id = a.job_id
      WHERE ia.organization_id = ${organizationId}::uuid
        AND ia.interviewer_user_id = ${userId}::uuid
        AND ia.status <> 'cancelled'
      ORDER BY ia.scheduled_for ASC NULLS LAST, ia.created_at DESC
    `;

    return rows.map((row) => ({
      assignmentId: String(row.assignment_id),
      assignmentStatus: String(row.assignment_status),
      ...(asIso(row.scheduled_for) ? { scheduledFor: asIso(row.scheduled_for) } : {}),
      sessionId: String(row.session_id),
      sessionStatus: String(row.session_status),
      ...(asIso(row.started_at) ? { startedAt: asIso(row.started_at) } : {}),
      ...(asIso(row.completed_at) ? { completedAt: asIso(row.completed_at) } : {}),
      applicationId: String(row.application_id),
      candidateId: String(row.candidate_id),
      candidateName: String(row.candidate_name),
      jobId: String(row.job_id),
      jobTitle: String(row.job_title),
    }));
  }

  async getMine(sessionId: string) {
    const assignment = await this.requireAssignedSession(sessionId);
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      SELECT
        s.id::text AS session_id,
        s.status AS session_status,
        s.started_at,
        s.completed_at,
        s.remaining_seconds,
        a.id::text AS application_id,
        a.pipeline_stage,
        c.id::text AS candidate_id,
        c.display_name AS candidate_name,
        c."current_role" AS current_role,
        c.current_company,
        c.location,
        j.id::text AS job_id,
        j.title AS job_title,
        ip.id::text AS plan_id,
        ip.language,
        ip.interview_type,
        ip.time_budget_minutes
      FROM interview_sessions s
      JOIN applications a
        ON a.organization_id = s.organization_id AND a.id = s.application_id
      JOIN candidates c
        ON c.organization_id = a.organization_id AND c.id = a.candidate_id
      JOIN jobs j
        ON j.organization_id = a.organization_id AND j.id = a.job_id
      JOIN interview_plans ip
        ON ip.organization_id = s.organization_id AND ip.id = s.interview_plan_id
      WHERE s.organization_id = ${organizationId}::uuid
        AND s.id = ${sessionId}::uuid
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) throw new NotFoundException("Interview session was not found");

    return {
      assignment,
      session: {
        id: String(row.session_id),
        status: String(row.session_status),
        ...(asIso(row.started_at) ? { startedAt: asIso(row.started_at) } : {}),
        ...(asIso(row.completed_at) ? { completedAt: asIso(row.completed_at) } : {}),
        remainingSeconds: row.remaining_seconds == null ? null : Number(row.remaining_seconds),
      },
      application: {
        id: String(row.application_id),
        pipelineStage: String(row.pipeline_stage),
      },
      candidate: {
        id: String(row.candidate_id),
        displayName: String(row.candidate_name),
        ...(row.current_role ? { currentRole: String(row.current_role) } : {}),
        ...(row.current_company ? { currentCompany: String(row.current_company) } : {}),
        ...(row.location ? { location: String(row.location) } : {}),
      },
      job: { id: String(row.job_id), title: String(row.job_title) },
      plan: {
        id: String(row.plan_id),
        language: String(row.language),
        interviewType: String(row.interview_type),
        timeBudgetMinutes: Number(row.time_budget_minutes),
      },
    };
  }

  async start(sessionId: string) {
    const assignment = await this.requireAssignedSession(sessionId);
    if (!["assigned", "accepted"].includes(assignment.status)) {
      throw new ForbiddenException("This interviewer assignment is not active");
    }
    const organizationId = this.tenantContext.require().organizationId;
    const userId = this.requireUserId();

    const result = await this.database.sql.begin(async (tx) => {
      const rows = await tx`
        UPDATE interview_sessions
        SET status = 'in_progress',
            started_at = COALESCE(started_at, now()),
            updated_at = now()
        WHERE organization_id = ${organizationId}::uuid
          AND id = ${sessionId}::uuid
          AND status IN ('invited', 'scheduled')
        RETURNING id::text, status, started_at
      `;
      if (!rows[0]) {
        const current = await tx`
          SELECT status, started_at
          FROM interview_sessions
          WHERE organization_id = ${organizationId}::uuid AND id = ${sessionId}::uuid
          LIMIT 1
        `;
        if (String(current[0]?.status) !== "in_progress") {
          throw new ConflictException("Interview session cannot be started from its current state");
        }
        rows.push(current[0] as never);
      }
      await tx`
        UPDATE interview_assignments
        SET status = 'accepted', updated_at = now()
        WHERE organization_id = ${organizationId}::uuid
          AND interview_session_id = ${sessionId}::uuid
          AND interviewer_user_id = ${userId}::uuid
      `;
      return rows[0];
    });

    await this.audit.record({
      action: "interview.start",
      entityType: "interview_session",
      entityId: sessionId,
    });
    return {
      sessionId,
      status: String(result?.status ?? "in_progress"),
      ...(asIso(result?.started_at) ? { startedAt: asIso(result?.started_at) } : {}),
    };
  }

  async complete(sessionId: string) {
    await this.requireAssignedSession(sessionId);
    const organizationId = this.tenantContext.require().organizationId;
    const userId = this.requireUserId();

    const rows = await this.database.sql.begin(async (tx) => {
      const updated = await tx`
        UPDATE interview_sessions
        SET status = 'completed', completed_at = COALESCE(completed_at, now()), updated_at = now()
        WHERE organization_id = ${organizationId}::uuid
          AND id = ${sessionId}::uuid
          AND status = 'in_progress'
        RETURNING application_id::text, completed_at
      `;
      if (!updated[0]) throw new ConflictException("Only an in-progress interview can be completed");
      await tx`
        UPDATE interview_assignments
        SET status = 'completed', updated_at = now()
        WHERE organization_id = ${organizationId}::uuid
          AND interview_session_id = ${sessionId}::uuid
          AND interviewer_user_id = ${userId}::uuid
      `;
      await tx`
        UPDATE applications
        SET pipeline_stage = 'review', updated_at = now()
        WHERE organization_id = ${organizationId}::uuid
          AND id = ${String(updated[0].application_id)}::uuid
      `;
      return updated[0];
    });

    await this.audit.record({
      action: "interview.finish",
      entityType: "interview_session",
      entityId: sessionId,
    });
    return { sessionId, status: "completed", completedAt: asIso(rows?.completed_at) };
  }

  async addNote(sessionId: string, input: InterviewerNoteInputDto) {
    await this.requireAssignedSession(sessionId);
    const organizationId = this.tenantContext.require().organizationId;
    const userId = this.requireUserId();
    const rows = await this.database.sql`
      INSERT INTO interview_notes (organization_id, interview_session_id, author_user_id, body)
      VALUES (${organizationId}::uuid, ${sessionId}::uuid, ${userId}::uuid, ${input.body.trim()})
      RETURNING id::text, body, created_at, updated_at
    `;
    const row = rows[0];
    await this.audit.record({
      action: "interview.note.create",
      entityType: "interview_session",
      entityId: sessionId,
      metadata: { noteId: String(row?.id) },
    });
    return {
      id: String(row?.id),
      body: String(row?.body),
      createdAt: asIso(row?.created_at),
      updatedAt: asIso(row?.updated_at),
    };
  }

  async listNotes(sessionId: string) {
    await this.requireAssignedSession(sessionId);
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      SELECT n.id::text, n.body, n.author_user_id::text, u.display_name, n.created_at, n.updated_at
      FROM interview_notes n
      JOIN users u ON u.id = n.author_user_id
      WHERE n.organization_id = ${organizationId}::uuid
        AND n.interview_session_id = ${sessionId}::uuid
      ORDER BY n.created_at DESC
    `;
    return rows.map((row) => ({
      id: String(row.id),
      body: String(row.body),
      authorUserId: String(row.author_user_id),
      ...(row.display_name ? { authorName: String(row.display_name) } : {}),
      createdAt: asIso(row.created_at),
      updatedAt: asIso(row.updated_at),
    }));
  }

  async submitEvaluation(sessionId: string, input: SubmitInterviewerEvaluationDto) {
    await this.requireAssignedSession(sessionId);
    if (input.criterionResults.length === 0) {
      throw new BadRequestException("At least one criterion result is required");
    }
    const organizationId = this.tenantContext.require().organizationId;
    const userId = this.requireUserId();

    const rows = await this.database.sql`
      INSERT INTO interview_evaluations (
        organization_id,
        interview_session_id,
        rubric_version_id,
        evaluator_version,
        status,
        criterion_results,
        recommendation,
        human_review_state
      )
      SELECT
        s.organization_id,
        s.id,
        ip.rubric_version_id,
        ${`human:${userId}`},
        'submitted',
        ${this.database.sql.json(input.criterionResults as never)},
        ${input.recommendation ?? null},
        'submitted'
      FROM interview_sessions s
      JOIN interview_plans ip
        ON ip.organization_id = s.organization_id AND ip.id = s.interview_plan_id
      WHERE s.organization_id = ${organizationId}::uuid
        AND s.id = ${sessionId}::uuid
        AND s.status IN ('in_progress', 'completed')
      RETURNING id::text, status, recommendation, created_at
    `;
    const row = rows[0];
    if (!row) throw new ConflictException("Evaluation cannot be submitted for this session state");

    await this.audit.record({
      action: "interview.score.submit",
      entityType: "interview_evaluation",
      entityId: String(row.id),
      metadata: { sessionId },
    });
    return {
      id: String(row.id),
      sessionId,
      status: String(row.status),
      recommendation: row.recommendation == null ? null : String(row.recommendation),
      createdAt: asIso(row.created_at),
    };
  }

  private requireUserId(): string {
    const userId = this.authContext.getOptional()?.userId;
    if (!userId) throw new UnauthorizedException("Authentication is required");
    return userId;
  }

  private async requireAssignedSession(sessionId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const userId = this.requireUserId();
    const rows = await this.database.sql`
      SELECT id::text, status, scheduled_for
      FROM interview_assignments
      WHERE organization_id = ${organizationId}::uuid
        AND interview_session_id = ${sessionId}::uuid
        AND interviewer_user_id = ${userId}::uuid
        AND status <> 'cancelled'
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) throw new ForbiddenException("This interview is not assigned to the current interviewer");
    return {
      id: String(row.id),
      status: String(row.status),
      ...(asIso(row.scheduled_for) ? { scheduledFor: asIso(row.scheduled_for) } : {}),
    };
  }
}

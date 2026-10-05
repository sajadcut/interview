import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AuthContextService } from "../auth/auth-context.service";
import { CandidateAuthService } from "../auth/candidate-auth.service";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import { InterviewOrchestrationService } from "../interviews/interview-orchestration.service";
import type { PrepareAiInterviewDto, ScheduleTechnicalInterviewDto } from "./interviewer.dto";

@Injectable()
export class InterviewAssignmentAdminService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
    private readonly authContext: AuthContextService,
    private readonly interviewOrchestration: InterviewOrchestrationService,
    private readonly candidateAuth: CandidateAuthService,
  ) {}

  async prepareAiInterview(input: PrepareAiInterviewDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const actorUserId = this.authContext.getOptional()?.userId;
    if (!actorUserId) throw new BadRequestException("Authenticated user context is required");

    const language = input.language?.trim() || "fa";
    const applications = await this.database.sql`
      SELECT
        a.id::text,
        a.job_id::text,
        a.pipeline_stage,
        a.status,
        j.title AS job_title
      FROM applications a
      JOIN jobs j
        ON j.organization_id = a.organization_id
       AND j.id = a.job_id
      WHERE a.organization_id = ${organizationId}::uuid
        AND a.id = ${input.applicationId}::uuid
      LIMIT 1
    `;
    const application = applications[0];
    if (!application) throw new NotFoundException("Application not found");
    if (["closed", "withdrawn"].includes(String(application.status))) {
      throw new BadRequestException("A closed application cannot be sent to interview");
    }
    if (!["screening", "interview"].includes(String(application.pipeline_stage))) {
      throw new BadRequestException("Application must be in screening or interview before AI interview");
    }

    const publishedPlans = await this.database.sql`
      SELECT id::text
      FROM interview_plans
      WHERE organization_id = ${organizationId}::uuid
        AND job_id = ${String(application.job_id)}::uuid
        AND status = 'published'
        AND interview_type <> 'human_technical'
        AND language = ${language}
      ORDER BY version DESC
      LIMIT 1
    `;

    let interviewPlanId = publishedPlans[0]?.id ? String(publishedPlans[0].id) : undefined;
    if (!interviewPlanId) {
      const generated = await this.interviewOrchestration.generatePlan(String(application.job_id), {
        language,
        interviewType: "structured_competency",
        timeBudgetMinutes: 45,
        minDepth: 1,
        maxDepth: 3,
      });
      const published = await this.interviewOrchestration.publishPlan(generated.id);
      interviewPlanId = published.id;
    }

    await this.database.sql.begin(async (tx) => {
      const lockedRows = await tx`
        SELECT pipeline_stage
        FROM applications
        WHERE organization_id = ${organizationId}::uuid
          AND id = ${input.applicationId}::uuid
        LIMIT 1
        FOR UPDATE
      `;
      const currentStage = String(lockedRows[0]?.pipeline_stage ?? application.pipeline_stage);

      const latestAiMarker = await tx`
        SELECT 1
        FROM application_stage_transitions
        WHERE organization_id = ${organizationId}::uuid
          AND application_id = ${input.applicationId}::uuid
          AND to_stage = 'interview'
          AND reason = 'AI interviewer selected for the interview stage'
        ORDER BY created_at DESC
        LIMIT 1
      `;

      if (!latestAiMarker[0]) {
        await tx`
          INSERT INTO application_stage_transitions (
            organization_id,
            application_id,
            from_stage,
            to_stage,
            reason,
            actor_user_id
          ) VALUES (
            ${organizationId}::uuid,
            ${input.applicationId}::uuid,
            ${currentStage},
            'interview',
            'AI interviewer selected for the interview stage',
            ${actorUserId}::uuid
          )
        `;
      }

      if (currentStage !== "interview") {
        await tx`
          UPDATE applications
          SET pipeline_stage = 'interview', updated_at = now()
          WHERE organization_id = ${organizationId}::uuid
            AND id = ${input.applicationId}::uuid
        `;
      }
    });

    const invitation = await this.candidateAuth.createInvitation({
      applicationId: input.applicationId,
    });

    return {
      applicationId: input.applicationId,
      interviewPlanId,
      pipelineStage: "interview",
      invitation,
    };
  }

  async scheduleTechnicalInterview(input: ScheduleTechnicalInterviewDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const actorUserId = this.authContext.getOptional()?.userId;
    if (!actorUserId) throw new BadRequestException("Authenticated user context is required");

    const scheduledFor = new Date(input.scheduledFor);
    if (Number.isNaN(scheduledFor.getTime())) {
      throw new BadRequestException("scheduledFor must be a valid ISO date-time");
    }
    const durationMinutes = input.durationMinutes ?? 60;
    const language = input.language?.trim() || "fa";

    return this.database.sql.begin(async (tx) => {
      const applications = await tx`
        SELECT
          a.id::text,
          a.job_id::text,
          a.rubric_version_id::text,
          a.pipeline_stage,
          a.status,
          j.title AS job_title
        FROM applications a
        JOIN jobs j
          ON j.organization_id = a.organization_id
         AND j.id = a.job_id
        WHERE a.organization_id = ${organizationId}::uuid
          AND a.id = ${input.applicationId}::uuid
        LIMIT 1
        FOR UPDATE OF a
      `;
      const application = applications[0];
      if (!application) throw new NotFoundException("Application not found");
      if (["closed", "withdrawn"].includes(String(application.status))) {
        throw new BadRequestException("A closed application cannot be scheduled for interview");
      }
      if (!["screening", "interview"].includes(String(application.pipeline_stage))) {
        throw new BadRequestException("Application must be in screening before a technical interview can be scheduled");
      }

      const interviewers = await tx`
        SELECT m.id::text
        FROM interviewer_profiles ip
        JOIN users u
          ON lower(u.email) = lower(ip.email)
        JOIN memberships m
          ON m.organization_id = ip.organization_id
         AND m.user_id = u.id
        JOIN membership_roles mr
          ON mr.membership_id = m.id
         AND mr.organization_id = m.organization_id
        JOIN roles r
          ON r.id = mr.role_id
         AND r.organization_id = m.organization_id
        WHERE ip.organization_id = ${organizationId}::uuid
          AND ip.status = 'active'
          AND u.id = ${input.interviewerUserId}::uuid
          AND u.disabled_at IS NULL
          AND m.status = 'active'
          AND r.key = 'INTERVIEWER'
        LIMIT 1
      `;
      if (!interviewers[0]) {
        throw new BadRequestException("Assigned user must be an active INTERVIEWER in this organization");
      }

      let planRows = await tx`
        SELECT id::text
        FROM interview_plans
        WHERE organization_id = ${organizationId}::uuid
          AND job_id = ${String(application.job_id)}::uuid
          AND rubric_version_id = ${String(application.rubric_version_id)}::uuid
          AND interview_type = 'human_technical'
          AND language = ${language}
          AND time_budget_minutes = ${durationMinutes}
          AND status = 'published'
        ORDER BY version DESC
        LIMIT 1
      `;

      let planId = planRows[0]?.id ? String(planRows[0].id) : undefined;
      if (!planId) {
        const releaseRows = await tx`
          INSERT INTO interview_release_units (
            organization_id,
            job_family,
            language,
            interview_type,
            rubric_version_family,
            interviewer_policy_version,
            speech_avatar_stack_version,
            evaluator_version,
            lifecycle_stage
          ) VALUES (
            ${organizationId}::uuid,
            ${String(application.job_title)},
            ${language},
            'human_technical',
            ${`rubric:${String(application.rubric_version_id)}`},
            'human-technical-v1',
            'not-applicable',
            'human-evaluator-v1',
            'DEV_ONLY'
          )
          ON CONFLICT (
            organization_id, job_family, language, interview_type, rubric_version_family,
            interviewer_policy_version, speech_avatar_stack_version, evaluator_version
          )
          DO UPDATE SET updated_at = now()
          RETURNING id::text
        `;
        const releaseUnitId = String(releaseRows[0]?.id);
        const versionRows = await tx`
          SELECT COALESCE(max(version), 0)::int + 1 AS next_version
          FROM interview_plans
          WHERE organization_id = ${organizationId}::uuid
            AND job_id = ${String(application.job_id)}::uuid
        `;
        const version = Number(versionRows[0]?.next_version ?? 1);
        planRows = await tx`
          INSERT INTO interview_plans (
            organization_id,
            job_id,
            rubric_version_id,
            release_unit_id,
            version,
            status,
            language,
            interview_type,
            time_budget_minutes,
            question_strategy,
            forbidden_topics,
            recovery_policy
          ) VALUES (
            ${organizationId}::uuid,
            ${String(application.job_id)}::uuid,
            ${String(application.rubric_version_id)}::uuid,
            ${releaseUnitId}::uuid,
            ${version},
            'published',
            ${language},
            'human_technical',
            ${durationMinutes},
            ${this.database.sql.json({
              mode: "human",
              evidenceFirst: true,
              decisionAuthority: "human",
            } as never)},
            '[]'::jsonb,
            ${this.database.sql.json({ resumeFromCheckpoint: false } as never)}
          )
          RETURNING id::text
        `;
        planId = String(planRows[0]?.id);
      }

      const existingSessions = await tx`
        SELECT s.id::text
        FROM interview_sessions s
        JOIN interview_plans p
          ON p.organization_id = s.organization_id
         AND p.id = s.interview_plan_id
        WHERE s.organization_id = ${organizationId}::uuid
          AND s.application_id = ${input.applicationId}::uuid
          AND p.interview_type = 'human_technical'
          AND s.status IN ('invited', 'scheduled', 'in_progress', 'paused', 'disconnected')
        ORDER BY s.created_at DESC
        LIMIT 1
        FOR UPDATE OF s
      `;

      let sessionId = existingSessions[0]?.id ? String(existingSessions[0].id) : undefined;
      if (!sessionId) {
        const sessions = await tx`
          INSERT INTO interview_sessions (
            organization_id,
            application_id,
            interview_plan_id,
            status,
            remaining_seconds,
            checkpoint
          ) VALUES (
            ${organizationId}::uuid,
            ${input.applicationId}::uuid,
            ${planId}::uuid,
            'scheduled',
            ${durationMinutes * 60},
            ${this.database.sql.json({
              interviewMode: "human_technical",
              interviewerUserId: input.interviewerUserId,
              scheduledFor: scheduledFor.toISOString(),
              durationMinutes,
            } as never)}
          )
          RETURNING id::text
        `;
        sessionId = String(sessions[0]?.id);
      } else {
        await tx`
          UPDATE interview_sessions
          SET status = CASE WHEN status = 'invited' THEN 'scheduled' ELSE status END,
              remaining_seconds = ${durationMinutes * 60},
              checkpoint = checkpoint || ${this.database.sql.json({
                interviewMode: "human_technical",
                interviewerUserId: input.interviewerUserId,
                scheduledFor: scheduledFor.toISOString(),
                durationMinutes,
              } as never)}::jsonb,
              updated_at = now()
          WHERE organization_id = ${organizationId}::uuid
            AND id = ${sessionId}::uuid
        `;
      }

      await tx`
        UPDATE interview_assignments
        SET status = 'cancelled', updated_at = now()
        WHERE organization_id = ${organizationId}::uuid
          AND interview_session_id = ${sessionId}::uuid
          AND interviewer_user_id <> ${input.interviewerUserId}::uuid
          AND status <> 'cancelled'
      `;

      await tx`
        INSERT INTO interview_assignments (
          organization_id,
          interview_session_id,
          interviewer_user_id,
          assigned_by_user_id,
          status,
          scheduled_for
        ) VALUES (
          ${organizationId}::uuid,
          ${sessionId}::uuid,
          ${input.interviewerUserId}::uuid,
          ${actorUserId}::uuid,
          'assigned',
          ${scheduledFor}
        )
        ON CONFLICT (organization_id, interview_session_id, interviewer_user_id)
        DO UPDATE SET
          assigned_by_user_id = EXCLUDED.assigned_by_user_id,
          status = 'assigned',
          scheduled_for = EXCLUDED.scheduled_for,
          updated_at = now()
      `;

      const fromStage = String(application.pipeline_stage);
      if (fromStage !== "interview") {
        await tx`
          INSERT INTO application_stage_transitions (
            organization_id,
            application_id,
            from_stage,
            to_stage,
            reason,
            actor_user_id
          ) VALUES (
            ${organizationId}::uuid,
            ${input.applicationId}::uuid,
            ${fromStage},
            'interview',
            'Technical interview scheduled',
            ${actorUserId}::uuid
          )
        `;
        await tx`
          UPDATE applications
          SET pipeline_stage = 'interview', updated_at = now()
          WHERE organization_id = ${organizationId}::uuid
            AND id = ${input.applicationId}::uuid
        `;
      }

      return {
        sessionId,
        applicationId: input.applicationId,
        interviewerUserId: input.interviewerUserId,
        scheduledFor: scheduledFor.toISOString(),
        durationMinutes,
        pipelineStage: "interview",
      };
    });
  }

  async getOptions() {
    const organizationId = this.tenantContext.require().organizationId;
    const [sessions, pendingApplications, interviewers] = await Promise.all([
      this.database.sql`
        SELECT
          s.id::text AS session_id,
          s.status AS session_status,
          s.created_at,
          a.id::text AS application_id,
          c.display_name AS candidate_name,
          j.title AS job_title,
          ia.interviewer_user_id::text,
          COALESCE(
            NULLIF(trim(concat_ws(' ', ip.first_name, ip.last_name)), ''),
            iu.display_name,
            iu.email
          ) AS interviewer_name,
          iu.email AS interviewer_email,
          ia.status AS assignment_status,
          COALESCE(
            ia.scheduled_for,
            NULLIF(s.checkpoint->>'scheduledFor', '')::timestamptz
          ) AS scheduled_for
        FROM interview_sessions s
        JOIN applications a
          ON a.organization_id = s.organization_id AND a.id = s.application_id
        JOIN candidates c
          ON c.organization_id = a.organization_id AND c.id = a.candidate_id
        JOIN jobs j
          ON j.organization_id = a.organization_id AND j.id = a.job_id
        LEFT JOIN LATERAL (
          SELECT current_assignment.*
          FROM interview_assignments current_assignment
          WHERE current_assignment.organization_id = s.organization_id
            AND current_assignment.interview_session_id = s.id
            AND current_assignment.status <> 'cancelled'
          ORDER BY current_assignment.updated_at DESC, current_assignment.created_at DESC
          LIMIT 1
        ) ia ON true
        LEFT JOIN users iu ON iu.id = ia.interviewer_user_id
        LEFT JOIN interviewer_profiles ip
          ON ip.organization_id = s.organization_id
         AND lower(ip.email) = lower(iu.email)
        WHERE s.organization_id = ${organizationId}::uuid
          AND s.status NOT IN ('cancelled')
        ORDER BY
          CASE WHEN s.status IN ('completed', 'failed') THEN 1 ELSE 0 END,
          COALESCE(
            ia.scheduled_for,
            NULLIF(s.checkpoint->>'scheduledFor', '')::timestamptz,
            s.created_at
          ) DESC
      `,
      this.database.sql`
        SELECT
          a.id::text AS application_id,
          c.display_name AS candidate_name,
          j.title AS job_title,
          CASE
            WHEN latest_transition.reason = 'AI interviewer selected for the interview stage' THEN 'ai'
            WHEN previous_assignment.interviewer_user_id IS NOT NULL THEN 'human'
            ELSE NULL
          END AS interviewer_mode,
          previous_assignment.interviewer_user_id::text,
          previous_assignment.interviewer_name,
          previous_assignment.interviewer_email
        FROM applications a
        JOIN candidates c
          ON c.organization_id = a.organization_id
         AND c.id = a.candidate_id
        JOIN jobs j
          ON j.organization_id = a.organization_id
         AND j.id = a.job_id
        LEFT JOIN LATERAL (
          SELECT
            ast.reason
          FROM application_stage_transitions ast
          WHERE ast.organization_id = a.organization_id
            AND ast.application_id = a.id
            AND ast.to_stage = 'interview'
          ORDER BY ast.created_at DESC, ast.id DESC
          LIMIT 1
        ) latest_transition ON true
        LEFT JOIN LATERAL (
          SELECT
            ia.interviewer_user_id,
            COALESCE(
              NULLIF(trim(concat_ws(' ', ip.first_name, ip.last_name)), ''),
              iu.display_name,
              iu.email
            ) AS interviewer_name,
            iu.email AS interviewer_email
          FROM interview_sessions historical_session
          JOIN interview_assignments ia
            ON ia.organization_id = historical_session.organization_id
           AND ia.interview_session_id = historical_session.id
           AND ia.status <> 'cancelled'
          JOIN users iu ON iu.id = ia.interviewer_user_id
          LEFT JOIN interviewer_profiles ip
            ON ip.organization_id = historical_session.organization_id
           AND lower(ip.email) = lower(iu.email)
          WHERE historical_session.organization_id = a.organization_id
            AND historical_session.application_id = a.id
          ORDER BY ia.updated_at DESC, historical_session.created_at DESC
          LIMIT 1
        ) previous_assignment ON true
        WHERE a.organization_id = ${organizationId}::uuid
          AND a.pipeline_stage = 'interview'
          AND a.status NOT IN ('closed', 'withdrawn')
          AND NOT EXISTS (
            SELECT 1
            FROM interview_sessions active_session
            WHERE active_session.organization_id = a.organization_id
              AND active_session.application_id = a.id
              AND active_session.status IN (
                'invited',
                'scheduled',
                'in_progress',
                'paused',
                'disconnected',
                'reconnecting'
              )
          )
        ORDER BY a.updated_at DESC
      `,
      this.database.sql`
        SELECT DISTINCT
          ip.id::text AS profile_id,
          u.id::text AS user_id,
          ip.email,
          concat_ws(' ', ip.first_name, ip.last_name) AS display_name,
          ip.specialties,
          lower(ip.email) AS email_sort_key
        FROM interviewer_profiles ip
        JOIN users u ON lower(u.email) = lower(ip.email)
        JOIN memberships m
          ON m.organization_id = ip.organization_id
         AND m.user_id = u.id
        JOIN membership_roles mr
          ON mr.membership_id = m.id AND mr.organization_id = m.organization_id
        JOIN roles r
          ON r.id = mr.role_id AND r.organization_id = m.organization_id
        WHERE ip.organization_id = ${organizationId}::uuid
          AND ip.status = 'active'
          AND m.status = 'active'
          AND u.disabled_at IS NULL
          AND r.key = 'INTERVIEWER'
        ORDER BY email_sort_key
      `,
    ]);

    const scheduledSessions = sessions.map((row) => ({
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
    }));

    const unscheduledApplications = pendingApplications.map((row) => ({
      sessionStatus: "needs_scheduling",
      applicationId: String(row.application_id),
      candidateName: String(row.candidate_name),
      jobTitle: String(row.job_title),
      ...(row.interviewer_mode ? { interviewerMode: String(row.interviewer_mode) as "ai" | "human" } : {}),
      ...(row.interviewer_user_id ? { interviewerUserId: String(row.interviewer_user_id) } : {}),
      ...(row.interviewer_name ? { interviewerName: String(row.interviewer_name) } : {}),
      ...(row.interviewer_email ? { interviewerEmail: String(row.interviewer_email) } : {}),
    }));

    return {
      sessions: [...unscheduledApplications, ...scheduledSessions],
      interviewers: interviewers.map((row) => ({
        profileId: String(row.profile_id),
        userId: String(row.user_id),
        email: String(row.email),
        ...(row.display_name ? { displayName: String(row.display_name) } : {}),
        specialties: Array.isArray(row.specialties)
          ? row.specialties.filter((value): value is string => typeof value === "string")
          : [],
      })),
    };
  }
}

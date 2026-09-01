import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";

@Injectable()
export class EngagementWorkspaceService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async getWorkspace() {
    const organizationId = this.tenantContext.require().organizationId;

    const [conversationRows, screeningRows, schedulingRows, notificationRows, knowledgeRows] =
      await Promise.all([
        this.database.sql`
          SELECT
            c.id::text,
            c.candidate_id::text,
            c.application_id::text,
            c.channel,
            c.status,
            c.updated_at,
            candidate.display_name AS candidate_name,
            latest.id::text AS latest_message_id,
            latest.direction AS latest_direction,
            latest.body AS latest_body,
            latest.approval_state AS latest_approval_state,
            latest.delivery_status AS latest_delivery_status,
            latest.created_at AS latest_message_at
          FROM conversations c
          JOIN candidates candidate
            ON candidate.organization_id = c.organization_id
           AND candidate.id = c.candidate_id
          LEFT JOIN LATERAL (
            SELECT m.id, m.direction, m.body, m.approval_state, m.delivery_status, m.created_at
            FROM messages m
            WHERE m.organization_id = c.organization_id
              AND m.conversation_id = c.id
            ORDER BY m.created_at DESC
            LIMIT 1
          ) latest ON true
          WHERE c.organization_id = ${organizationId}::uuid
          ORDER BY COALESCE(latest.created_at, c.updated_at) DESC
          LIMIT 100
        `,
        this.database.sql`
          SELECT
            s.id::text,
            s.application_id::text,
            s.status,
            s.recommendation,
            s.review_state,
            s.reviewer_reason,
            s.created_at,
            c.display_name AS candidate_name,
            j.title AS job_title
          FROM screening_sessions s
          JOIN applications a
            ON a.organization_id = s.organization_id AND a.id = s.application_id
          JOIN candidates c
            ON c.organization_id = a.organization_id AND c.id = a.candidate_id
          JOIN jobs j
            ON j.organization_id = a.organization_id AND j.id = a.job_id
          WHERE s.organization_id = ${organizationId}::uuid
          ORDER BY s.created_at DESC
          LIMIT 100
        `,
        this.database.sql`
          SELECT
            sr.id::text,
            sr.application_id::text,
            sr.interview_type,
            sr.status,
            sr.timezone,
            sr.selected_start,
            sr.selected_end,
            sr.cancellation_reason,
            c.display_name AS candidate_name,
            j.title AS job_title
          FROM scheduling_requests sr
          JOIN applications a
            ON a.organization_id = sr.organization_id AND a.id = sr.application_id
          JOIN candidates c
            ON c.organization_id = a.organization_id AND c.id = a.candidate_id
          JOIN jobs j
            ON j.organization_id = a.organization_id AND j.id = a.job_id
          WHERE sr.organization_id = ${organizationId}::uuid
          ORDER BY sr.created_at DESC
          LIMIT 100
        `,
        this.database.sql`
          SELECT
            n.id::text,
            n.candidate_id::text,
            n.application_id::text,
            n.notification_type,
            n.channel,
            n.status,
            n.scheduled_for,
            n.sent_at,
            n.created_at,
            c.display_name AS candidate_name
          FROM recruitment_notifications n
          LEFT JOIN candidates c
            ON c.organization_id = n.organization_id AND c.id = n.candidate_id
          WHERE n.organization_id = ${organizationId}::uuid
          ORDER BY COALESCE(n.scheduled_for, n.created_at) DESC
          LIMIT 100
        `,
        this.database.sql`
          SELECT id::text, job_id::text, knowledge_type, title, status, approved_at, updated_at
          FROM knowledge_items
          WHERE organization_id = ${organizationId}::uuid
          ORDER BY updated_at DESC
          LIMIT 100
        `,
      ]);

    return {
      conversations: conversationRows,
      screening: screeningRows,
      scheduling: schedulingRows,
      notifications: notificationRows,
      knowledge: knowledgeRows,
      policy: {
        candidateFactsRequireApprovedKnowledge: true,
        screeningRequiresHumanReview: true,
        externalDeliveryRequiresConfiguredProvider: true,
      },
    };
  }
}

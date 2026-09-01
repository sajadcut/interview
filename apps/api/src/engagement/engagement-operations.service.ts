import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AuthContextService } from "../auth/auth-context.service";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import type {
  ApproveKnowledgeItemDto,
  ApproveOutboundMessageDto,
  CancelSchedulingDto,
  CreateConversationDto,
  CreateKnowledgeItemDto,
  CreateNotificationDto,
  InboundMessageDto,
  RecordNotificationDeliveryDto,
  ReviewScreeningDto,
} from "./engagement-operations.dto";

function userId(auth: AuthContextService): string {
  const id = auth.getOptional()?.userId;
  if (!id) throw new BadRequestException("Authenticated user context is required");
  return id;
}

function optionalDate(value: string | undefined, field: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new BadRequestException(`${field} must be an ISO date`);
  return date;
}

@Injectable()
export class EngagementOperationsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
    private readonly authContext: AuthContextService,
  ) {}

  async createKnowledgeItem(input: CreateKnowledgeItemDto) {
    const organizationId = this.tenantContext.require().organizationId;
    if (input.jobId) {
      const jobs = await this.database.sql`
        SELECT 1 FROM jobs
        WHERE organization_id = ${organizationId}::uuid AND id = ${input.jobId}::uuid
        LIMIT 1
      `;
      if (!jobs[0]) throw new NotFoundException("Job not found");
    }
    const rows = await this.database.sql`
      INSERT INTO knowledge_items (
        organization_id, job_id, knowledge_type, title, body, status
      ) VALUES (
        ${organizationId}::uuid,
        ${input.jobId ?? null}::uuid,
        ${input.knowledgeType.trim()},
        ${input.title.trim()},
        ${input.body.trim()},
        'draft'
      )
      RETURNING id::text, job_id::text, knowledge_type, title, body, status, created_at
    `;
    return rows[0];
  }

  async approveKnowledgeItem(itemId: string, input: ApproveKnowledgeItemDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const reviewer = userId(this.authContext);
    const validFrom = optionalDate(input.validFrom, "validFrom");
    const validUntil = optionalDate(input.validUntil, "validUntil");
    if (validFrom && validUntil && validUntil <= validFrom) {
      throw new BadRequestException("validUntil must be after validFrom");
    }
    const rows = await this.database.sql`
      UPDATE knowledge_items
      SET status = 'approved',
          approved_by_user_id = ${reviewer}::uuid,
          approved_at = now(),
          valid_from = ${validFrom},
          valid_until = ${validUntil},
          updated_at = now()
      WHERE organization_id = ${organizationId}::uuid AND id = ${itemId}::uuid
      RETURNING id::text, job_id::text, knowledge_type, title, status, approved_at, valid_from, valid_until
    `;
    if (!rows[0]) throw new NotFoundException("Knowledge item not found");
    return rows[0];
  }

  async listKnowledge(jobId?: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = jobId
      ? await this.database.sql`
          SELECT id::text, job_id::text, knowledge_type, title, body, status,
                 approved_by_user_id::text, approved_at, valid_from, valid_until, updated_at
          FROM knowledge_items
          WHERE organization_id = ${organizationId}::uuid
            AND (job_id = ${jobId}::uuid OR job_id IS NULL)
          ORDER BY updated_at DESC
        `
      : await this.database.sql`
          SELECT id::text, job_id::text, knowledge_type, title, body, status,
                 approved_by_user_id::text, approved_at, valid_from, valid_until, updated_at
          FROM knowledge_items
          WHERE organization_id = ${organizationId}::uuid
          ORDER BY updated_at DESC
        `;
    return rows;
  }

  async createConversation(input: CreateConversationDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const candidates = await this.database.sql`
      SELECT 1 FROM candidates
      WHERE organization_id = ${organizationId}::uuid AND id = ${input.candidateId}::uuid
      LIMIT 1
    `;
    if (!candidates[0]) throw new NotFoundException("Candidate not found");
    if (input.applicationId) {
      const applications = await this.database.sql`
        SELECT 1 FROM applications
        WHERE organization_id = ${organizationId}::uuid
          AND id = ${input.applicationId}::uuid
          AND candidate_id = ${input.candidateId}::uuid
        LIMIT 1
      `;
      if (!applications[0]) throw new BadRequestException("Application does not belong to candidate");
    }
    const rows = await this.database.sql`
      INSERT INTO conversations (organization_id, candidate_id, application_id, channel, status)
      VALUES (
        ${organizationId}::uuid,
        ${input.candidateId}::uuid,
        ${input.applicationId ?? null}::uuid,
        ${input.channel},
        'open'
      )
      RETURNING id::text, candidate_id::text, application_id::text, channel, status, created_at
    `;
    return rows[0];
  }

  async createInboundMessage(conversationId: string, input: InboundMessageDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const conversations = await this.database.sql`
      SELECT 1 FROM conversations
      WHERE organization_id = ${organizationId}::uuid AND id = ${conversationId}::uuid
      LIMIT 1
    `;
    if (!conversations[0]) throw new NotFoundException("Conversation not found");
    const rows = await this.database.sql`
      INSERT INTO messages (
        organization_id, conversation_id, direction, sender_type, body,
        grounding_references, approval_state, provider_reference, sent_at, delivery_status
      ) VALUES (
        ${organizationId}::uuid,
        ${conversationId}::uuid,
        'inbound',
        'candidate',
        ${input.body.trim()},
        '[]'::jsonb,
        'not_required',
        ${input.providerReference?.trim() || null},
        now(),
        'received'
      )
      RETURNING id::text, direction, sender_type, body, provider_reference, sent_at, delivery_status, created_at
    `;
    await this.database.sql`
      UPDATE conversations SET updated_at = now()
      WHERE organization_id = ${organizationId}::uuid AND id = ${conversationId}::uuid
    `;
    return rows[0];
  }

  async approveOutboundMessage(messageId: string, input: ApproveOutboundMessageDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      UPDATE messages
      SET approval_state = 'approved_for_send',
          delivery_status = CASE WHEN ${Boolean(input.providerReference)} THEN 'sent' ELSE 'queued' END,
          provider_reference = COALESCE(${input.providerReference?.trim() || null}, provider_reference),
          sent_at = CASE WHEN ${Boolean(input.providerReference)} THEN now() ELSE sent_at END,
          delivery_error = NULL
      WHERE organization_id = ${organizationId}::uuid
        AND id = ${messageId}::uuid
        AND direction = 'outbound'
        AND approval_state <> 'blocked'
      RETURNING id::text, conversation_id::text, approval_state, delivery_status, provider_reference, sent_at
    `;
    if (!rows[0]) throw new NotFoundException("Approachable outbound message not found");
    return rows[0];
  }

  async reviewScreening(sessionId: string, input: ReviewScreeningDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const reviewer = userId(this.authContext);
    const recommendation =
      input.reviewState === "overridden_advance"
        ? "advance"
        : input.reviewState === "overridden_reject"
          ? "reject"
          : null;
    const rows = await this.database.sql`
      UPDATE screening_sessions
      SET review_state = ${input.reviewState},
          recommendation = COALESCE(${recommendation}, recommendation),
          reviewed_by_user_id = ${reviewer}::uuid,
          reviewer_reason = ${input.reason.trim()},
          reviewed_at = now(),
          updated_at = now()
      WHERE organization_id = ${organizationId}::uuid AND id = ${sessionId}::uuid
      RETURNING id::text, application_id::text, status, recommendation, review_state,
                reviewer_reason, reviewed_at
    `;
    if (!rows[0]) throw new NotFoundException("Screening session not found");
    return rows[0];
  }

  async listScreening(applicationId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    return this.database.sql`
      SELECT id::text, application_id::text, status, rules_version, answers, hard_filter_result,
             recommendation, review_state, reviewed_by_user_id::text, reviewer_reason, reviewed_at,
             created_at, updated_at
      FROM screening_sessions
      WHERE organization_id = ${organizationId}::uuid AND application_id = ${applicationId}::uuid
      ORDER BY created_at DESC
    `;
  }

  async cancelScheduling(requestId: string, input: CancelSchedulingDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      UPDATE scheduling_requests
      SET status = 'cancelled',
          cancelled_at = now(),
          cancellation_reason = ${input.reason.trim()},
          updated_at = now()
      WHERE organization_id = ${organizationId}::uuid
        AND id = ${requestId}::uuid
        AND status <> 'cancelled'
      RETURNING id::text, application_id::text, status, cancellation_reason, cancelled_at
    `;
    if (!rows[0]) throw new NotFoundException("Active scheduling request not found");
    return rows[0];
  }

  async createNotification(input: CreateNotificationDto) {
    const organizationId = this.tenantContext.require().organizationId;
    if (!input.candidateId && !input.applicationId) {
      throw new BadRequestException("candidateId or applicationId is required");
    }
    const scheduledFor = optionalDate(input.scheduledFor, "scheduledFor");
    const rows = await this.database.sql`
      INSERT INTO recruitment_notifications (
        organization_id, candidate_id, application_id, notification_type,
        channel, status, scheduled_for, payload
      ) VALUES (
        ${organizationId}::uuid,
        ${input.candidateId ?? null}::uuid,
        ${input.applicationId ?? null}::uuid,
        ${input.notificationType.trim()},
        ${input.channel},
        'pending',
        ${scheduledFor},
        ${this.database.sql.json((input.payload ?? {}) as never)}
      )
      RETURNING id::text, candidate_id::text, application_id::text, notification_type,
                channel, status, scheduled_for, created_at
    `;
    return rows[0];
  }

  async listNotifications(status?: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = status
      ? await this.database.sql`
          SELECT id::text, candidate_id::text, application_id::text, notification_type,
                 channel, status, scheduled_for, sent_at, payload, created_at
          FROM recruitment_notifications
          WHERE organization_id = ${organizationId}::uuid AND status = ${status}
          ORDER BY COALESCE(scheduled_for, created_at), created_at
          LIMIT 250
        `
      : await this.database.sql`
          SELECT id::text, candidate_id::text, application_id::text, notification_type,
                 channel, status, scheduled_for, sent_at, payload, created_at
          FROM recruitment_notifications
          WHERE organization_id = ${organizationId}::uuid
          ORDER BY COALESCE(scheduled_for, created_at), created_at
          LIMIT 250
        `;
    return rows;
  }

  async recordNotificationDelivery(notificationId: string, input: RecordNotificationDeliveryDto) {
    const organizationId = this.tenantContext.require().organizationId;
    return this.database.sql.begin(async (tx) => {
      const notifications = await tx`
        SELECT id::text FROM recruitment_notifications
        WHERE organization_id = ${organizationId}::uuid AND id = ${notificationId}::uuid
        LIMIT 1
        FOR UPDATE
      `;
      if (!notifications[0]) throw new NotFoundException("Notification not found");
      await tx`
        INSERT INTO notification_delivery_attempts (
          organization_id, notification_id, provider, state, provider_reference, error_message
        ) VALUES (
          ${organizationId}::uuid,
          ${notificationId}::uuid,
          ${input.provider.trim()},
          ${input.state},
          ${input.providerReference?.trim() || null},
          ${input.errorMessage?.trim() || null}
        )
      `;
      await tx`
        UPDATE recruitment_notifications
        SET status = ${input.state},
            sent_at = CASE WHEN ${input.state === "sent"} THEN now() ELSE sent_at END
        WHERE organization_id = ${organizationId}::uuid AND id = ${notificationId}::uuid
      `;
      return { notificationId, status: input.state, provider: input.provider };
    });
  }
}

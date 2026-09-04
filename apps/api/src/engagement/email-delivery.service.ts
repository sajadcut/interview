import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import { EMAIL_PROVIDER, type EmailProvider } from "./engagement-provider.contracts";
import { EmailDeliveryError } from "./email.providers";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function deliveryErrorMessage(error: unknown): string {
  if (error instanceof EmailDeliveryError) {
    return `${error.code}; retryable=${String(error.retryable)}; ${error.message}`.slice(0, 2_000);
  }
  if (error instanceof Error) return error.message.slice(0, 2_000);
  return "Unknown email delivery error";
}

@Injectable()
export class EmailDeliveryService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
  ) {}

  readiness() {
    return {
      provider: this.emailProvider.providerKey,
      configured: this.emailProvider.configured,
      failClosed: true,
    };
  }

  async sendApprovedMessage(messageId: string) {
    if (!this.emailProvider.configured) {
      throw new ServiceUnavailableException(
        `Email provider ${this.emailProvider.providerKey} is not configured`,
      );
    }
    const organizationId = this.tenantContext.require().organizationId;
    let failure: unknown = null;

    const result = await this.database.sql.begin(async (tx) => {
      const rows = await tx`
        SELECT
          m.id::text,
          m.body,
          m.approval_state,
          m.delivery_status,
          m.provider_reference,
          m.sent_at,
          c.channel,
          candidate.primary_email
        FROM messages m
        JOIN conversations c
          ON c.organization_id = m.organization_id AND c.id = m.conversation_id
        JOIN candidates candidate
          ON candidate.organization_id = c.organization_id AND candidate.id = c.candidate_id
        WHERE m.organization_id = ${organizationId}::uuid
          AND m.id = ${messageId}::uuid
          AND m.direction = 'outbound'
        FOR UPDATE OF m
      `;
      const row = rows[0];
      if (!row) throw new NotFoundException("Outbound message not found");
      if (String(row.channel) !== "email") {
        throw new BadRequestException("Outbound message conversation is not an email channel");
      }
      if (!["approved_for_send", "approved_for_auto_send"].includes(String(row.approval_state))) {
        throw new BadRequestException("Outbound message must be approved before email delivery");
      }
      if (String(row.delivery_status) === "sent" && row.provider_reference) {
        return {
          messageId,
          state: "sent" as const,
          provider: this.emailProvider.providerKey,
          providerReference: String(row.provider_reference),
          acceptedAt: row.sent_at ? new Date(String(row.sent_at)).toISOString() : null,
          idempotentReplay: true,
        };
      }
      const recipient = typeof row.primary_email === "string" ? row.primary_email.trim() : "";
      if (!recipient) throw new BadRequestException("Candidate does not have a primary email address");

      try {
        const delivered = await this.emailProvider.send({
          organizationId,
          notificationId: messageId,
          recipient,
          subject: "Recruiting update",
          body: String(row.body),
          idempotencyKey: `message:${organizationId}:${messageId}`,
        });
        const acceptedAt = new Date(delivered.acceptedAt);
        const sentAt = Number.isNaN(acceptedAt.getTime()) ? new Date() : acceptedAt;
        await tx`
          UPDATE messages
          SET delivery_status = 'sent',
              delivery_error = NULL,
              provider_reference = ${delivered.providerReference},
              sent_at = ${sentAt}
          WHERE organization_id = ${organizationId}::uuid AND id = ${messageId}::uuid
        `;
        await tx`
          UPDATE conversations
          SET provider_reference = COALESCE(provider_reference, ${delivered.providerReference}),
              updated_at = now()
          WHERE organization_id = ${organizationId}::uuid
            AND id = (
              SELECT conversation_id FROM messages
              WHERE organization_id = ${organizationId}::uuid AND id = ${messageId}::uuid
            )
        `;
        return {
          messageId,
          state: "sent" as const,
          provider: delivered.provider,
          providerReference: delivered.providerReference,
          acceptedAt: sentAt.toISOString(),
          idempotentReplay: false,
        };
      } catch (error) {
        failure = error;
        await tx`
          UPDATE messages
          SET delivery_status = 'failed', delivery_error = ${deliveryErrorMessage(error)}
          WHERE organization_id = ${organizationId}::uuid AND id = ${messageId}::uuid
        `;
        return null;
      }
    });

    if (failure) throw failure;
    return result;
  }

  async sendNotification(notificationId: string) {
    if (!this.emailProvider.configured) {
      throw new ServiceUnavailableException(
        `Email provider ${this.emailProvider.providerKey} is not configured`,
      );
    }
    const organizationId = this.tenantContext.require().organizationId;
    let failure: unknown = null;

    const result = await this.database.sql.begin(async (tx) => {
      const rows = await tx`
        SELECT
          n.id::text,
          n.channel,
          n.status,
          n.scheduled_for,
          n.sent_at,
          n.provider_reference,
          n.payload,
          candidate.primary_email
        FROM recruitment_notifications n
        LEFT JOIN applications a
          ON a.organization_id = n.organization_id AND a.id = n.application_id
        JOIN candidates candidate
          ON candidate.organization_id = n.organization_id
         AND candidate.id = COALESCE(n.candidate_id, a.candidate_id)
        WHERE n.organization_id = ${organizationId}::uuid
          AND n.id = ${notificationId}::uuid
        FOR UPDATE OF n
      `;
      const row = rows[0];
      if (!row) throw new NotFoundException("Recruitment notification not found");
      if (String(row.channel) !== "email") {
        throw new BadRequestException("Recruitment notification is not an email notification");
      }
      if (String(row.status) === "sent" && row.provider_reference) {
        return {
          notificationId,
          state: "sent" as const,
          provider: this.emailProvider.providerKey,
          providerReference: String(row.provider_reference),
          acceptedAt: row.sent_at ? new Date(String(row.sent_at)).toISOString() : null,
          idempotentReplay: true,
        };
      }
      if (!["pending", "failed"].includes(String(row.status))) {
        throw new BadRequestException(`Notification in ${String(row.status)} state cannot be delivered`);
      }
      if (row.scheduled_for && new Date(String(row.scheduled_for)).getTime() > Date.now()) {
        throw new BadRequestException("Notification is scheduled for a future delivery time");
      }
      const recipient = typeof row.primary_email === "string" ? row.primary_email.trim() : "";
      if (!recipient) throw new BadRequestException("Candidate does not have a primary email address");
      const payload = asRecord(row.payload);
      const subject = typeof payload.subject === "string" && payload.subject.trim()
        ? payload.subject.trim()
        : "Recruiting notification";
      const body = typeof payload.body === "string" ? payload.body.trim() : "";
      if (!body) throw new BadRequestException("Email notification payload requires a non-empty body");

      try {
        const delivered = await this.emailProvider.send({
          organizationId,
          notificationId,
          recipient,
          subject,
          body,
          idempotencyKey: `notification:${organizationId}:${notificationId}`,
        });
        const acceptedAt = new Date(delivered.acceptedAt);
        const sentAt = Number.isNaN(acceptedAt.getTime()) ? new Date() : acceptedAt;
        await tx`
          INSERT INTO notification_delivery_attempts (
            organization_id, notification_id, provider, state, provider_reference, attempted_at
          ) VALUES (
            ${organizationId}::uuid, ${notificationId}::uuid, ${delivered.provider},
            'sent', ${delivered.providerReference}, ${sentAt}
          )
        `;
        await tx`
          UPDATE recruitment_notifications
          SET status = 'sent', sent_at = ${sentAt}, provider_reference = ${delivered.providerReference}
          WHERE organization_id = ${organizationId}::uuid AND id = ${notificationId}::uuid
        `;
        return {
          notificationId,
          state: "sent" as const,
          provider: delivered.provider,
          providerReference: delivered.providerReference,
          acceptedAt: sentAt.toISOString(),
          idempotentReplay: false,
        };
      } catch (error) {
        failure = error;
        const errorMessage = deliveryErrorMessage(error);
        await tx`
          INSERT INTO notification_delivery_attempts (
            organization_id, notification_id, provider, state, error_message, attempted_at
          ) VALUES (
            ${organizationId}::uuid, ${notificationId}::uuid,
            ${this.emailProvider.providerKey}, 'failed', ${errorMessage}, now()
          )
        `;
        await tx`
          UPDATE recruitment_notifications
          SET status = 'failed'
          WHERE organization_id = ${organizationId}::uuid AND id = ${notificationId}::uuid
        `;
        return null;
      }
    });

    if (failure) throw failure;
    return result;
  }
}

import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import { EmailDeliveryService } from "./email-delivery.service";
import { EngagementService } from "./engagement.service";

@Injectable()
export class EmailAwareEngagementService extends EngagementService {
  constructor(
    database: DatabaseService,
    tenantContext: TenantContextService,
    private readonly emailDatabase: DatabaseService,
    private readonly emailTenantContext: TenantContextService,
    private readonly emailDelivery: EmailDeliveryService,
  ) {
    super(database, tenantContext);
  }

  override async createOutboundMessage(conversationId: string, body: unknown) {
    const result = await super.createOutboundMessage(conversationId, body);
    const message = result.message;
    if (
      result.approvalState !== "approved_for_auto_send"
      || !message
      || typeof message !== "object"
      || !("id" in message)
      || !message.id
    ) {
      return result;
    }

    const organizationId = this.emailTenantContext.require().organizationId;
    const messageId = String(message.id);
    await this.emailDatabase.sql`
      UPDATE messages
      SET sent_at = NULL, delivery_status = 'queued', delivery_error = NULL
      WHERE organization_id = ${organizationId}::uuid AND id = ${messageId}::uuid
    `;

    const queuedMessage = { ...message, sent_at: null, delivery_status: "queued" };
    if (!this.emailDelivery.readiness().configured) {
      return { ...result, message: queuedMessage, delivery: null };
    }

    const delivery = await this.emailDelivery.sendApprovedMessage(messageId);
    return {
      ...result,
      message: {
        ...queuedMessage,
        sent_at: delivery?.acceptedAt ?? null,
        delivery_status: delivery?.state ?? "failed",
        provider_reference: delivery?.providerReference ?? null,
      },
      delivery,
    };
  }
}

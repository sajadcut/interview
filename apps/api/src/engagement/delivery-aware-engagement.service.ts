import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import { CalendarDeliveryService } from "./calendar-delivery.service";
import { EmailDeliveryService } from "./email-delivery.service";
import { EngagementService } from "./engagement.service";

@Injectable()
export class DeliveryAwareEngagementService extends EngagementService {
  constructor(
    database: DatabaseService,
    tenantContext: TenantContextService,
    private readonly deliveryDatabase: DatabaseService,
    private readonly deliveryTenantContext: TenantContextService,
    private readonly emailDelivery: EmailDeliveryService,
    private readonly calendarDelivery: CalendarDeliveryService,
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

    const organizationId = this.deliveryTenantContext.require().organizationId;
    const messageId = String(message.id);
    await this.deliveryDatabase.sql`
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

  override confirmSchedulingRequest(requestId: string, body: unknown) {
    return this.calendarDelivery.confirmSchedulingRequest(requestId, body);
  }
}

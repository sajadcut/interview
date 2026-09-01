import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AuditedAction } from "../audit/audited-action.decorator";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import {
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
import { EngagementOperationsService } from "./engagement-operations.service";

@ApiTags("engagement-operations")
@Controller("v1")
@RequireTenant()
export class EngagementOperationsController {
  constructor(private readonly operations: EngagementOperationsService) {}

  @Get("knowledge")
  @RequirePermissions(Permissions.CandidateRead)
  listKnowledge(@Query("jobId") jobId?: string) {
    return this.operations.listKnowledge(jobId);
  }

  @Post("knowledge")
  @RequirePermissions(Permissions.KnowledgeManage)
  @AuditedAction("knowledge.create", "knowledge_item")
  createKnowledge(@Body() body: CreateKnowledgeItemDto) {
    return this.operations.createKnowledgeItem(body);
  }

  @Post("knowledge/:itemId/approve")
  @RequirePermissions(Permissions.KnowledgeManage)
  @AuditedAction("knowledge.approve", "knowledge_item")
  approveKnowledge(@Param("itemId") itemId: string, @Body() body: ApproveKnowledgeItemDto) {
    return this.operations.approveKnowledgeItem(itemId, body);
  }

  @Post("conversations")
  @RequirePermissions(Permissions.CandidateContact)
  @AuditedAction("conversation.create", "conversation")
  createConversation(@Body() body: CreateConversationDto) {
    return this.operations.createConversation(body);
  }

  @Post("conversations/:conversationId/messages/inbound")
  @RequirePermissions(Permissions.CandidateContact)
  @AuditedAction("candidate.message.inbound.record", "conversation")
  createInboundMessage(
    @Param("conversationId") conversationId: string,
    @Body() body: InboundMessageDto,
  ) {
    return this.operations.createInboundMessage(conversationId, body);
  }

  @Post("messages/:messageId/approve-send")
  @RequirePermissions(Permissions.CandidateContact)
  @AuditedAction("candidate.message.outbound.approve", "message")
  approveOutboundMessage(
    @Param("messageId") messageId: string,
    @Body() body: ApproveOutboundMessageDto,
  ) {
    return this.operations.approveOutboundMessage(messageId, body);
  }

  @Get("applications/:applicationId/screening/sessions")
  @RequirePermissions(Permissions.CandidateRead)
  listScreening(@Param("applicationId") applicationId: string) {
    return this.operations.listScreening(applicationId);
  }

  @Post("screening/sessions/:sessionId/review")
  @RequirePermissions(Permissions.ScreeningManage)
  @AuditedAction("screening.session.review", "screening_session")
  reviewScreening(@Param("sessionId") sessionId: string, @Body() body: ReviewScreeningDto) {
    return this.operations.reviewScreening(sessionId, body);
  }

  @Patch("scheduling/:requestId/cancel")
  @RequirePermissions(Permissions.SchedulingManage)
  @AuditedAction("scheduling.request.cancel", "scheduling_request")
  cancelScheduling(@Param("requestId") requestId: string, @Body() body: CancelSchedulingDto) {
    return this.operations.cancelScheduling(requestId, body);
  }

  @Get("notifications")
  @RequirePermissions(Permissions.CandidateRead)
  listNotifications(@Query("status") status?: string) {
    return this.operations.listNotifications(status?.trim());
  }

  @Post("notifications")
  @RequirePermissions(Permissions.CandidateContact)
  @AuditedAction("notification.create", "notification")
  createNotification(@Body() body: CreateNotificationDto) {
    return this.operations.createNotification(body);
  }

  @Post("notifications/:notificationId/delivery")
  @RequirePermissions(Permissions.CandidateContact)
  @AuditedAction("notification.delivery.record", "notification")
  recordNotificationDelivery(
    @Param("notificationId") notificationId: string,
    @Body() body: RecordNotificationDeliveryDto,
  ) {
    return this.operations.recordNotificationDelivery(notificationId, body);
  }
}

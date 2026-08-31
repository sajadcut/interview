import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { AuditedAction } from "../audit/audited-action.decorator";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import {
  ConversationDto,
  OutboundMessageRequestDto,
  SchedulingConfirmationDto,
  SchedulingRequestDto,
  SchedulingRequestInputDto,
  ScreeningSessionDto,
  ScreeningSessionRequestDto,
} from "./engagement.dto";
import { EngagementService } from "./engagement.service";

@ApiTags("engagement")
@Controller("v1")
@RequireTenant()
export class EngagementController {
  constructor(private readonly engagement: EngagementService) {}

  @Post("engagement/replies/policy-preview")
  @RequirePermissions(Permissions.CandidateContact)
  previewCandidateReply(@Body() body: OutboundMessageRequestDto) {
    return this.engagement.previewCandidateReply(body);
  }

  @Get("conversations/:conversationId")
  @RequirePermissions(Permissions.CandidateRead)
  @ApiOkResponse({ type: ConversationDto })
  getConversation(@Param("conversationId") conversationId: string) {
    return this.engagement.getConversation(conversationId);
  }

  @Post("conversations/:conversationId/messages/outbound")
  @RequirePermissions(Permissions.CandidateContact)
  @AuditedAction("candidate.message.outbound.prepare", "conversation")
  createOutboundMessage(
    @Param("conversationId") conversationId: string,
    @Body() body: OutboundMessageRequestDto,
  ) {
    return this.engagement.createOutboundMessage(conversationId, body);
  }

  @Post("applications/:applicationId/screening/preview")
  @RequirePermissions(Permissions.ScreeningManage)
  @AuditedAction("screening.preview", "application")
  previewScreening(@Body() body: ScreeningSessionRequestDto) {
    return this.engagement.previewScreening(body);
  }

  @Post("applications/:applicationId/screening/sessions")
  @RequirePermissions(Permissions.ScreeningManage)
  @AuditedAction("screening.session.create", "application")
  @ApiOkResponse({ type: ScreeningSessionDto })
  createScreeningSession(
    @Param("applicationId") applicationId: string,
    @Body() body: ScreeningSessionRequestDto,
  ) {
    return this.engagement.createScreeningSession(applicationId, body);
  }

  @Post("applications/:applicationId/scheduling")
  @RequirePermissions(Permissions.SchedulingManage)
  @AuditedAction("scheduling.request.create", "application")
  @ApiOkResponse({ type: SchedulingRequestDto })
  createSchedulingRequest(
    @Param("applicationId") applicationId: string,
    @Body() body: SchedulingRequestInputDto,
  ) {
    return this.engagement.createSchedulingRequest(applicationId, body);
  }

  @Get("applications/:applicationId/scheduling")
  @RequirePermissions(Permissions.CandidateRead)
  @ApiOkResponse({ type: SchedulingRequestDto, isArray: true })
  listSchedulingRequests(@Param("applicationId") applicationId: string) {
    return this.engagement.listSchedulingRequests(applicationId);
  }

  @Patch("scheduling/:requestId/confirm")
  @RequirePermissions(Permissions.SchedulingManage)
  @AuditedAction("scheduling.request.confirm", "scheduling_request")
  @ApiOkResponse({ type: SchedulingRequestDto })
  confirmSchedulingRequest(
    @Param("requestId") requestId: string,
    @Body() body: SchedulingConfirmationDto,
  ) {
    return this.engagement.confirmSchedulingRequest(requestId, body);
  }
}

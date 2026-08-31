import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { AuditedAction } from "../audit/audited-action.decorator";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import {
  InterviewMediaEventInputDto,
  InterviewMediaModeDto,
  InterviewMediaReadinessQueryDto,
} from "./interview-media.dto";
import { InterviewMediaService } from "./interview-media.service";

@ApiTags("interview-media")
@Controller("v1/interviews")
@RequireTenant()
export class InterviewMediaController {
  constructor(private readonly media: InterviewMediaService) {}

  @Get("media/readiness")
  @RequirePermissions(Permissions.InterviewManage)
  @ApiOkResponse({ description: "Provider-neutral realtime media readiness. No credentials are returned." })
  getReadiness(@Query() query: InterviewMediaReadinessQueryDto) {
    return this.media.getReadiness(query.mode ?? "audio");
  }

  @Post(":sessionId/media/preflight")
  @RequirePermissions(Permissions.InterviewManage)
  @AuditedAction("interview.media.preflight", "interview_session")
  @ApiOkResponse({ description: "Consent, release and provider readiness for a realtime media session." })
  preflight(@Param("sessionId") sessionId: string, @Body() body: InterviewMediaModeDto) {
    return this.media.preflight(sessionId, body.mode);
  }

  @Post(":sessionId/media/sessions")
  @RequirePermissions(Permissions.InterviewManage)
  @AuditedAction("interview.media.session.create", "interview_media_session")
  @ApiOkResponse({ description: "Persist a media lifecycle session after a successful preflight." })
  createMediaSession(@Param("sessionId") sessionId: string, @Body() body: InterviewMediaModeDto) {
    return this.media.createMediaSession(sessionId, body.mode);
  }

  @Get(":sessionId/media/sessions/latest")
  @RequirePermissions(Permissions.InterviewRead)
  @ApiOkResponse({ description: "Latest persisted media lifecycle state for the interview session." })
  getLatestMediaSession(@Param("sessionId") sessionId: string) {
    return this.media.getLatestMediaSession(sessionId);
  }

  @Post(":sessionId/media/sessions/:mediaSessionId/events")
  @RequirePermissions(Permissions.InterviewManage)
  @AuditedAction("interview.media.event.append", "interview_media_session")
  @ApiOkResponse({ description: "Append an operational media event without raw media or transcript content." })
  appendEvent(
    @Param("sessionId") sessionId: string,
    @Param("mediaSessionId") mediaSessionId: string,
    @Body() body: InterviewMediaEventInputDto,
  ) {
    return this.media.appendEvent(sessionId, mediaSessionId, body);
  }
}

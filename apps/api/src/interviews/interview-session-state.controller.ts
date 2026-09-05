import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiExcludeEndpoint, ApiTags } from "@nestjs/swagger";
import { AuditedAction } from "../audit/audited-action.decorator";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import { InterviewSessionTransitionInputDto } from "./interview-session-state.dto";
import { InterviewSessionStateService } from "./interview-session-state.service";

@ApiTags("interview-session-state")
@Controller("v1/interviews")
@RequireTenant()
export class InterviewSessionStateController {
  constructor(private readonly state: InterviewSessionStateService) {}

  @Get(":sessionId/state")
  @ApiExcludeEndpoint()
  @RequirePermissions(Permissions.InterviewRead)
  getState(@Param("sessionId") sessionId: string) {
    return this.state.getState(sessionId);
  }

  @Post(":sessionId/state/transitions")
  @ApiExcludeEndpoint()
  @RequirePermissions(Permissions.InterviewManage)
  @AuditedAction("interview.session.transition", "interview_session")
  transition(
    @Param("sessionId") sessionId: string,
    @Body() body: InterviewSessionTransitionInputDto,
  ) {
    return this.state.transition(sessionId, body);
  }
}

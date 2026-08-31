import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import { InterviewsService } from "./interviews.service";

@Controller("v1")
@RequireTenant()
export class InterviewsController {
  constructor(private readonly interviews: InterviewsService) {}

  @Get("interviews/:sessionId/review")
  @RequirePermissions(Permissions.InterviewRead)
  getReview(@Param("sessionId") sessionId: string) {
    return this.interviews.getReview(sessionId);
  }

  @Post("interview-release-units/:releaseUnitId/preflight")
  @RequirePermissions(Permissions.InterviewManage)
  preflightRelease(@Param("releaseUnitId") releaseUnitId: string, @Body() body: unknown) {
    return this.interviews.preflightRelease(releaseUnitId, body);
  }
}

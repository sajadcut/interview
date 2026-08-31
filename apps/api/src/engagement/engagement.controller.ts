import { Body, Controller, Param, Post } from "@nestjs/common";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import { EngagementService } from "./engagement.service";

@Controller("v1")
@RequireTenant()
export class EngagementController {
  constructor(private readonly engagement: EngagementService) {}

  @Post("engagement/replies/policy-preview")
  @RequirePermissions(Permissions.CandidateContact)
  previewCandidateReply(@Body() body: unknown) {
    return this.engagement.previewCandidateReply(body);
  }

  @Post("applications/:applicationId/screening/preview")
  @RequirePermissions(Permissions.ScreeningManage)
  previewScreening(@Body() body: unknown) {
    return this.engagement.previewScreening(body);
  }

  @Post("applications/:applicationId/scheduling")
  @RequirePermissions(Permissions.SchedulingManage)
  createSchedulingRequest(@Param("applicationId") applicationId: string, @Body() body: unknown) {
    return this.engagement.createSchedulingRequest(applicationId, body);
  }
}

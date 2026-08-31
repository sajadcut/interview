import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { AuditedAction } from "../audit/audited-action.decorator";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import { RecruitingService } from "./recruiting.service";

@Controller("v1")
@RequireTenant()
export class RecruitingController {
  constructor(private readonly recruiting: RecruitingService) {}

  @Get("applications/:applicationId/intelligence")
  @RequirePermissions(Permissions.CandidateRead)
  getApplicationIntelligence(@Param("applicationId") applicationId: string) {
    return this.recruiting.getApplicationIntelligence(applicationId);
  }

  @Post("applications/:applicationId/scorecards/preview")
  @RequirePermissions(Permissions.CandidateScore)
  @AuditedAction("scorecard.preview", "application")
  previewScorecard(@Body() body: unknown) {
    return this.recruiting.previewScorecard(body);
  }
}

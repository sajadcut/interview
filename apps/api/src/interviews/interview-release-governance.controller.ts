import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { AuditedAction } from "../audit/audited-action.decorator";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import { ApproveInterviewReleaseDto, InterviewReleaseApprovalEventDto, SuspendInterviewReleaseDto } from "./interview-release-governance.dto";
import { InterviewReleaseGovernanceService } from "./interview-release-governance.service";

@ApiTags("interview-release-governance")
@Controller("v1/interview-release-units")
@RequireTenant()
export class InterviewReleaseGovernanceController {
  constructor(private readonly service: InterviewReleaseGovernanceService) {}

  @Post(":releaseUnitId/approve")
  @RequirePermissions(Permissions.InterviewManage)
  @AuditedAction("interview.release.approve", "interview_release_unit")
  approve(@Param("releaseUnitId") id: string, @Body() body: ApproveInterviewReleaseDto) { return this.service.approve(id, body); }

  @Post(":releaseUnitId/suspend")
  @RequirePermissions(Permissions.InterviewManage)
  @AuditedAction("interview.release.suspend", "interview_release_unit")
  suspend(@Param("releaseUnitId") id: string, @Body() body: SuspendInterviewReleaseDto) { return this.service.suspend(id, body); }

  @Get(":releaseUnitId/approval-history")
  @RequirePermissions(Permissions.InterviewRead)
  @ApiOkResponse({ type: [InterviewReleaseApprovalEventDto] })
  history(@Param("releaseUnitId") id: string) { return this.service.history(id); }
}

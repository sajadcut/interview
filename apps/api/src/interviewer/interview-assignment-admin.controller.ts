import { Body, Controller, Get, Post } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { Permissions } from "../auth/permissions";
import { AuditedAction } from "../audit/audited-action.decorator";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { ApiStandardErrorResponses } from "../common/http/api-standard-error-responses.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import {
  InterviewAssignmentOptionsDto,
  ScheduleTechnicalInterviewDto,
  ScheduledTechnicalInterviewDto,
} from "./interviewer.dto";
import { InterviewAssignmentAdminService } from "./interview-assignment-admin.service";

@ApiTags("interview-operations")
@Controller("v1/interview-operations")
@RequireTenant()
@RequirePermissions(Permissions.InterviewAssign)
export class InterviewAssignmentAdminController {
  constructor(private readonly assignments: InterviewAssignmentAdminService) {}

  @Get("assignment-options")
  @ApiOkResponse({ type: InterviewAssignmentOptionsDto })
  @ApiStandardErrorResponses()
  getAssignmentOptions() {
    return this.assignments.getOptions();
  }

  @Post("technical-interviews")
  @AuditedAction("interview.technical.schedule", "interview_session")
  @ApiOkResponse({ type: ScheduledTechnicalInterviewDto })
  @ApiStandardErrorResponses()
  scheduleTechnicalInterview(@Body() body: ScheduleTechnicalInterviewDto) {
    return this.assignments.scheduleTechnicalInterview(body);
  }
}

import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { ApiStandardErrorResponses } from "../common/http/api-standard-error-responses.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import { InterviewAssignmentOptionsDto } from "./interviewer.dto";
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
}

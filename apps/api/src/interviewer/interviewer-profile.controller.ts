// Managed interviewer profile collection for human interviewer CRUD and assignment discovery.
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from "@nestjs/common";
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { ApiStandardErrorResponses } from "../common/http/api-standard-error-responses.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import {
  CreateInterviewerProfileDto,
  InterviewerProfileDto,
  UpdateInterviewerProfileDto,
} from "./interviewer-profile.dto";
import { InterviewerProfileService } from "./interviewer-profile.service";

@ApiTags("interviewer-profiles")
@ApiStandardErrorResponses()
@Controller("v1/interview-operations/interviewers")
@RequireTenant()
export class InterviewerProfileController {
  constructor(private readonly profiles: InterviewerProfileService) {}

  @Get()
  @RequirePermissions(Permissions.InterviewAssign)
  @ApiOkResponse({ type: [InterviewerProfileDto] })
  list() {
    return this.profiles.list();
  }

  @Post()
  @RequirePermissions(Permissions.InterviewAssign)
  @ApiOkResponse({ type: InterviewerProfileDto })
  create(@Body() body: CreateInterviewerProfileDto) {
    return this.profiles.create(body);
  }

  @Patch(":profileId")
  @RequirePermissions(Permissions.InterviewAssign)
  @ApiOkResponse({ type: InterviewerProfileDto })
  update(
    @Param("profileId") profileId: string,
    @Body() body: UpdateInterviewerProfileDto,
  ) {
    return this.profiles.update(profileId, body);
  }

  @Delete(":profileId")
  @RequirePermissions(Permissions.InterviewAssign)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: "Interviewer profile removed; historical interview records are retained." })
  remove(@Param("profileId") profileId: string) {
    return this.profiles.remove(profileId);
  }
}

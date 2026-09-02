import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { ApiStandardErrorResponses } from "../common/http/api-standard-error-responses.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import { EngagementWorkspaceDto } from "./engagement-workspace.dto";
import { EngagementWorkspaceService } from "./engagement-workspace.service";

@ApiTags("engagement-workspace")
@Controller("v1/engagement")
@RequireTenant()
export class EngagementWorkspaceController {
  constructor(private readonly workspace: EngagementWorkspaceService) {}

  @Get("workspace")
  @RequirePermissions(Permissions.CandidateRead)
  @ApiOkResponse({ type: EngagementWorkspaceDto })
  @ApiStandardErrorResponses()
  getWorkspace() {
    return this.workspace.getWorkspace();
  }
}

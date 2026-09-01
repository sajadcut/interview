import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import { EngagementWorkspaceService } from "./engagement-workspace.service";

@ApiTags("engagement-workspace")
@Controller("v1/engagement")
@RequireTenant()
export class EngagementWorkspaceController {
  constructor(private readonly workspace: EngagementWorkspaceService) {}

  @Get("workspace")
  @RequirePermissions(Permissions.CandidateRead)
  getWorkspace() {
    return this.workspace.getWorkspace();
  }
}

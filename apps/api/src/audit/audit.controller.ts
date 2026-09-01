import { Controller, Get, Query } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import { AuditExportDto, AuditExportQueryDto } from "./audit-export.dto";
import { AuditService } from "./audit.service";

@ApiTags("audit")
@Controller("v1/audit")
@RequireTenant()
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get("export")
  @RequirePermissions(Permissions.AuditRead)
  @ApiOkResponse({ type: AuditExportDto })
  exportEvents(@Query() query: AuditExportQueryDto) {
    return this.audit.exportEvents(query);
  }
}

import { Controller, Get, Query } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import { AnalyticsSummaryDto } from "./analytics.dto";
import { AnalyticsService } from "./analytics.service";

@ApiTags("analytics")
@Controller("v1/analytics")
@RequireTenant()
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get("summary")
  @RequirePermissions(Permissions.AnalyticsRead)
  @ApiOkResponse({ type: AnalyticsSummaryDto })
  getSummary(@Query("jobId") jobId?: string) {
    return this.analytics.getSummary(jobId);
  }
}

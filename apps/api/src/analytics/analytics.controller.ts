import { Controller, Get, Query } from "@nestjs/common";
import { ApiOkResponse, ApiQuery, ApiTags } from "@nestjs/swagger";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { ApiStandardErrorResponses } from "../common/http/api-standard-error-responses.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import { AnalyticsSummaryDto } from "./analytics.dto";
import { AnalyticsService } from "./analytics.service";

@ApiTags("analytics")
@ApiStandardErrorResponses()
@Controller("v1/analytics")
@RequireTenant()
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get("summary")
  @RequirePermissions(Permissions.AnalyticsRead)
  @ApiQuery({ name: "jobId", required: false, type: String })
  @ApiOkResponse({ type: AnalyticsSummaryDto })
  getSummary(@Query("jobId") jobId?: string) {
    return this.analytics.getSummary(jobId);
  }
}

import { Body, Controller, Param, Post } from "@nestjs/common";
import { AuditedAction } from "../audit/audited-action.decorator";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import { SourcingService } from "./sourcing.service";

@Controller("v1/jobs/:jobId/sourcing")
@RequireTenant()
export class SourcingController {
  constructor(private readonly sourcing: SourcingService) {}

  @Post("internal")
  @RequirePermissions(Permissions.SourcingRun)
  @AuditedAction("sourcing.run.internal", "job")
  searchInternal(@Param("jobId") jobId: string, @Body() body: unknown) {
    const value = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const query = typeof value.query === "string" ? value.query : "";
    const rawLimit = typeof value.limit === "number" ? value.limit : 25;
    return this.sourcing.searchInternalTalent(jobId, query, Number.isFinite(rawLimit) ? rawLimit : 25);
  }
}

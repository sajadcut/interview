import { Controller, Get, Param, Query } from "@nestjs/common";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import { SourcingService } from "./sourcing.service";

@Controller("v1/jobs/:jobId/sourcing")
@RequireTenant()
export class SourcingController {
  constructor(private readonly sourcing: SourcingService) {}

  @Get("internal")
  @RequirePermissions(Permissions.SourcingRun)
  searchInternal(
    @Param("jobId") jobId: string,
    @Query("q") query = "",
    @Query("limit") rawLimit?: string,
  ) {
    const parsedLimit = rawLimit ? Number(rawLimit) : 25;
    return this.sourcing.searchInternalTalent(jobId, query, Number.isFinite(parsedLimit) ? parsedLimit : 25);
  }
}

import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { AuditedAction } from "../audit/audited-action.decorator";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import {
  SourcingRunDetailDto,
  SourcingRunRequestDto,
  SourcingRunSummaryDto,
  TalentCandidateDto,
} from "./sourcing.dto";
import { SourcingService } from "./sourcing.service";

@ApiTags("sourcing")
@Controller("v1")
@RequireTenant()
export class SourcingController {
  constructor(private readonly sourcing: SourcingService) {}

  @Get("talent")
  @RequirePermissions(Permissions.CandidateRead)
  @ApiOkResponse({ type: TalentCandidateDto, isArray: true })
  listTalent(@Query("limit") rawLimit?: string) {
    const limit = rawLimit ? Number(rawLimit) : 100;
    return this.sourcing.listTalentPool(Number.isFinite(limit) ? limit : 100);
  }

  @Get("jobs/:jobId/sourcing/runs")
  @RequirePermissions(Permissions.JobRead)
  @ApiOkResponse({ type: SourcingRunSummaryDto, isArray: true })
  listRuns(@Param("jobId") jobId: string) {
    return this.sourcing.listRuns(jobId);
  }

  @Get("sourcing/runs/:runId")
  @RequirePermissions(Permissions.JobRead)
  @ApiOkResponse({ type: SourcingRunDetailDto })
  getRun(@Param("runId") runId: string) {
    return this.sourcing.getRun(runId);
  }

  @Post("jobs/:jobId/sourcing/runs/internal")
  @RequirePermissions(Permissions.SourcingRun)
  @AuditedAction("sourcing.run.internal", "job")
  searchInternal(@Param("jobId") jobId: string, @Body() body: SourcingRunRequestDto) {
    const query = typeof body?.query === "string" ? body.query : "";
    const rawLimit = typeof body?.limit === "number" ? body.limit : 25;
    return this.sourcing.searchInternalTalent(jobId, query, Number.isFinite(rawLimit) ? rawLimit : 25);
  }
}

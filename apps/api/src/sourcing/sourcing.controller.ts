import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiOkResponse, ApiQuery, ApiTags } from "@nestjs/swagger";
import { AuditedAction } from "../audit/audited-action.decorator";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import {
  SourcingRetryRequestDto,
  SourcingRunDetailDto,
  SourcingRunExecutionDto,
  SourcingRunRequestDto,
  SourcingRunSummaryDto,
  SourcingSourceCapabilityDto,
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
  @ApiQuery({ name: "limit", required: false, type: Number, example: 100 })
  @ApiOkResponse({ type: TalentCandidateDto, isArray: true })
  listTalent(@Query("limit") rawLimit?: string) {
    const limit = rawLimit ? Number(rawLimit) : 100;
    return this.sourcing.listTalentPool(Number.isFinite(limit) ? limit : 100);
  }

  @Get("sourcing/sources")
  @RequirePermissions(Permissions.JobRead)
  @ApiOkResponse({ type: SourcingSourceCapabilityDto, isArray: true })
  listSourceCapabilities() {
    return this.sourcing.listSourceCapabilities();
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

  @Post("jobs/:jobId/sourcing/runs")
  @RequirePermissions(Permissions.SourcingRun)
  @AuditedAction("sourcing.run", "job")
  @ApiOkResponse({ type: SourcingRunExecutionDto })
  runSource(@Param("jobId") jobId: string, @Body() body: SourcingRunRequestDto) {
    return this.sourcing.runSource(jobId, body);
  }

  @Post("sourcing/runs/:runId/retry")
  @RequirePermissions(Permissions.SourcingRun)
  @AuditedAction("sourcing.run.retry", "sourcing_run")
  @ApiOkResponse({ type: SourcingRunExecutionDto })
  retrySource(@Param("runId") runId: string, @Body() body: SourcingRetryRequestDto) {
    return this.sourcing.retryRun(runId, body);
  }

  @Post("jobs/:jobId/sourcing/runs/internal")
  @RequirePermissions(Permissions.SourcingRun)
  @AuditedAction("sourcing.run.internal", "job")
  @ApiOkResponse({ type: SourcingRunExecutionDto })
  searchInternal(@Param("jobId") jobId: string, @Body() body: SourcingRunRequestDto) {
    return this.sourcing.searchInternalTalent(jobId, body.query, body.limit ?? 25);
  }
}

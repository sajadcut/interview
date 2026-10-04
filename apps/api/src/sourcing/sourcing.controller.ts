// Job-first sourcing: internal talent -> AI tool-call plan -> approved provider execution -> HR acceptance.
import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiOkResponse, ApiQuery, ApiTags } from "@nestjs/swagger";
import { AuditedAction } from "../audit/audited-action.decorator";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import {
  AcceptedDiscoveredCandidateDto,
  CandidateFinderExecuteDto,
  CandidateFinderExecutionDto,
  CandidateFinderPlanStatusDto,
  CandidateFinderResultAnalysisStatusDto,
  CandidateFinderStartDto,
  JobTalentAnalysisStartDto,
  JobTalentAnalysisStatusDto,
  JobTalentMatchDto,
  SourcingRetryRequestDto,
  SourcingRunDetailDto,
  SourcingRunExecutionDto,
  SourcingRunRequestDto,
  SourcingRunSummaryDto,
  SourcingSourceCapabilityDto,
  TalentCandidateDto,
} from "./sourcing.dto";
import { SourcingAgentService } from "./sourcing-agent.service";
import { SourcingService } from "./sourcing.service";
import { TalentOperationsService } from "./talent-operations.service";

@ApiTags("sourcing")
@Controller("v1")
@RequireTenant()
export class SourcingController {
  constructor(
    private readonly sourcing: SourcingService,
    private readonly agent: SourcingAgentService,
    private readonly talent: TalentOperationsService,
  ) {}

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

  @Get("jobs/:jobId/talent-matches")
  @RequirePermissions(Permissions.CandidateRead)
  @ApiQuery({ name: "limit", required: false, type: Number, example: 25 })
  @ApiOkResponse({ type: JobTalentMatchDto, isArray: true })
  jobTalentMatches(@Param("jobId") jobId: string, @Query("limit") rawLimit?: string) {
    const limit = rawLimit ? Number(rawLimit) : 25;
    return this.talent.listJobTalentMatches(jobId, Number.isFinite(limit) ? limit : 25);
  }

  @Post("jobs/:jobId/talent-matches/analysis")
  @RequirePermissions(Permissions.SourcingRun)
  @AuditedAction("sourcing.internal.ai_analysis", "job")
  @ApiOkResponse({ type: JobTalentAnalysisStartDto })
  startTalentAnalysis(@Param("jobId") jobId: string) {
    return this.agent.startTalentAnalysis(jobId);
  }

  @Get("sourcing/talent-analysis/:analysisJobId")
  @RequirePermissions(Permissions.CandidateRead)
  @ApiOkResponse({ type: JobTalentAnalysisStatusDto })
  talentAnalysis(@Param("analysisJobId") analysisJobId: string) {
    return this.agent.getTalentAnalysis(analysisJobId);
  }

  @Post("jobs/:jobId/candidate-finder")
  @RequirePermissions(Permissions.SourcingRun)
  @AuditedAction("sourcing.candidate_finder.plan", "job")
  @ApiOkResponse({ type: CandidateFinderStartDto })
  startCandidateFinder(@Param("jobId") jobId: string) {
    return this.agent.startCandidateFinder(jobId);
  }

  @Get("jobs/:jobId/candidate-finder/:planJobId")
  @RequirePermissions(Permissions.JobRead)
  @ApiOkResponse({ type: CandidateFinderPlanStatusDto })
  candidateFinderPlan(
    @Param("jobId") jobId: string,
    @Param("planJobId") planJobId: string,
  ) {
    return this.agent.getCandidateFinderPlan(jobId, planJobId);
  }

  @Post("jobs/:jobId/candidate-finder/:planJobId/execute")
  @RequirePermissions(Permissions.SourcingRun)
  @AuditedAction("sourcing.candidate_finder.execute", "job")
  @ApiOkResponse({ type: CandidateFinderExecutionDto })
  executeCandidateFinder(
    @Param("jobId") jobId: string,
    @Param("planJobId") planJobId: string,
    @Body() body: CandidateFinderExecuteDto,
  ) {
    return this.agent.executeCandidateFinder(jobId, planJobId, body);
  }

  @Get("sourcing/candidate-finder-analysis/:analysisJobId")
  @RequirePermissions(Permissions.CandidateRead)
  @ApiOkResponse({ type: CandidateFinderResultAnalysisStatusDto })
  candidateFinderAnalysis(@Param("analysisJobId") analysisJobId: string) {
    return this.agent.getFinderResultAnalysis(analysisJobId);
  }

  @Post("sourcing/discovered/:discoveredCandidateId/accept")
  @RequirePermissions(Permissions.CandidateMoveStage)
  @AuditedAction("sourcing.discovered.accept", "candidate")
  @ApiOkResponse({ type: AcceptedDiscoveredCandidateDto })
  acceptDiscoveredCandidate(@Param("discoveredCandidateId") discoveredCandidateId: string) {
    return this.agent.acceptDiscoveredCandidate(discoveredCandidateId);
  }
}

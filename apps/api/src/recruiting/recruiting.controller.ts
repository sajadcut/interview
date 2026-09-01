import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiOkResponse, ApiQuery, ApiTags } from "@nestjs/swagger";
import { AuditedAction } from "../audit/audited-action.decorator";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { ApiStandardErrorResponses } from "../common/http/api-standard-error-responses.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import {
  CandidateSummaryDto,
  CandidateWorkspaceDto,
  JobSummaryDto,
  JobWorkspaceDto,
} from "./recruiting.dto";
import { RecruitingService } from "./recruiting.service";

@ApiTags("recruiting")
@ApiStandardErrorResponses()
@Controller("v1")
@RequireTenant()
export class RecruitingController {
  constructor(private readonly recruiting: RecruitingService) {}

  @Get("jobs")
  @RequirePermissions(Permissions.JobRead)
  @ApiOkResponse({ type: JobSummaryDto, isArray: true })
  listJobs() {
    return this.recruiting.listJobs();
  }

  @Get("jobs/:jobId/workspace")
  @RequirePermissions(Permissions.JobRead)
  @ApiOkResponse({ type: JobWorkspaceDto })
  getJobWorkspace(@Param("jobId") jobId: string) {
    return this.recruiting.getJobWorkspace(jobId);
  }

  @Get("candidates")
  @RequirePermissions(Permissions.CandidateRead)
  @ApiQuery({ name: "jobId", required: false, type: String })
  @ApiOkResponse({ type: CandidateSummaryDto, isArray: true })
  listCandidates(@Query("jobId") jobId?: string) {
    return this.recruiting.listCandidates(jobId);
  }

  @Get("candidates/:candidateId/workspace")
  @RequirePermissions(Permissions.CandidateRead)
  @ApiOkResponse({ type: CandidateWorkspaceDto })
  getCandidateWorkspace(@Param("candidateId") candidateId: string) {
    return this.recruiting.getCandidateWorkspace(candidateId);
  }

  @Get("applications/:applicationId/intelligence")
  @RequirePermissions(Permissions.CandidateRead)
  getApplicationIntelligence(@Param("applicationId") applicationId: string) {
    return this.recruiting.getApplicationIntelligence(applicationId);
  }

  @Post("applications/:applicationId/scorecards/preview")
  @RequirePermissions(Permissions.CandidateScore)
  @AuditedAction("scorecard.preview", "application")
  previewScorecard(@Body() body: unknown) {
    return this.recruiting.previewScorecard(body);
  }
}

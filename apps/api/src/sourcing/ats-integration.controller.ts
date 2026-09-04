import { Body, Controller, Get, Param, Post, Put, Query } from "@nestjs/common";
import { ApiExcludeController, ApiOkResponse, ApiQuery, ApiTags } from "@nestjs/swagger";
import { AuditedAction } from "../audit/audited-action.decorator";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import {
  AtsApplicationLinkDto,
  AtsJobDto,
  AtsJobLinkDto,
  AtsJobLinkResponseDto,
  AtsProviderStatusDto,
  AtsStageUpdateDto,
  AtsVerifyResponseDto,
} from "./ats-integration.dto";
import { AtsIntegrationService } from "./ats-integration.service";

@ApiExcludeController()
@ApiTags("ats-integrations")
@Controller("v1/ats")
@RequireTenant()
export class AtsIntegrationController {
  constructor(private readonly ats: AtsIntegrationService) {}

  @Get("providers")
  @RequirePermissions(Permissions.JobRead)
  @ApiOkResponse({ type: AtsProviderStatusDto, isArray: true })
  listProviders() {
    return this.ats.listProviders();
  }

  @Post(":provider/verify")
  @RequirePermissions(Permissions.IntegrationManage)
  @AuditedAction("ats.integration.verify", "integration_connection")
  @ApiOkResponse({ type: AtsVerifyResponseDto })
  verify(@Param("provider") provider: string) {
    return this.ats.verify(provider);
  }

  @Get(":provider/jobs")
  @RequirePermissions(Permissions.JobRead)
  @ApiQuery({ name: "limit", required: false, type: Number, example: 100 })
  @ApiOkResponse({ type: AtsJobDto, isArray: true })
  listJobs(@Param("provider") provider: string, @Query("limit") rawLimit?: string) {
    const limit = rawLimit ? Number(rawLimit) : 100;
    return this.ats.listJobs(provider, Number.isFinite(limit) ? limit : 100);
  }

  @Put(":provider/jobs/:jobId/link")
  @RequirePermissions(Permissions.IntegrationManage)
  @AuditedAction("ats.job.link", "job")
  @ApiOkResponse({ type: AtsJobLinkResponseDto })
  linkJob(
    @Param("provider") provider: string,
    @Param("jobId") jobId: string,
    @Body() body: AtsJobLinkDto,
  ) {
    return this.ats.linkJob(provider, jobId, body.providerJobReference);
  }

  @Post(":provider/applications/:applicationId/export")
  @RequirePermissions(Permissions.IntegrationManage)
  @AuditedAction("ats.application.export", "application")
  exportApplication(
    @Param("provider") provider: string,
    @Param("applicationId") applicationId: string,
  ) {
    return this.ats.exportApplication(provider, applicationId);
  }

  @Put(":provider/applications/:applicationId/stage")
  @RequirePermissions(Permissions.CandidateMoveStage)
  @AuditedAction("ats.application.stage.update", "application")
  updateStage(
    @Param("provider") provider: string,
    @Param("applicationId") applicationId: string,
    @Body() body: AtsStageUpdateDto,
  ) {
    return this.ats.updateStage(
      provider,
      applicationId,
      body.targetStageReference,
      body.currentStageReference,
    );
  }

  @Get("applications/:applicationId/links")
  @RequirePermissions(Permissions.CandidateRead)
  @ApiOkResponse({ type: AtsApplicationLinkDto, isArray: true })
  listApplicationLinks(@Param("applicationId") applicationId: string) {
    return this.ats.listApplicationLinks(applicationId);
  }
}

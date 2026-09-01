import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { AuditedAction } from "../audit/audited-action.decorator";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { ApiStandardErrorResponses } from "../common/http/api-standard-error-responses.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import {
  SourcingAuditDto,
  SourcingExportDto,
  SourcingImportRequestDto,
  SourcingImportResultDto,
} from "./sourcing-import-export.dto";
import { SourcingImportExportService } from "./sourcing-import-export.service";

@ApiTags("sourcing")
@Controller("v1")
@RequireTenant()
@ApiStandardErrorResponses()
export class SourcingImportExportController {
  constructor(private readonly importExport: SourcingImportExportService) {}

  @Post("jobs/:jobId/sourcing/imports")
  @RequirePermissions(Permissions.SourcingRun)
  @AuditedAction("sourcing.import", "job")
  @ApiOkResponse({ type: SourcingImportResultDto })
  importCandidates(@Param("jobId") jobId: string, @Body() body: SourcingImportRequestDto) {
    return this.importExport.importCandidates(jobId, body);
  }

  @Get("sourcing/runs/:runId/export")
  @RequirePermissions(Permissions.JobRead)
  @AuditedAction("sourcing.export", "sourcing_run")
  @ApiOkResponse({ type: SourcingExportDto })
  exportRun(@Param("runId") runId: string) {
    return this.importExport.exportRun(runId);
  }

  @Get("sourcing/runs/:runId/audit")
  @RequirePermissions(Permissions.JobRead)
  @ApiOkResponse({ type: SourcingAuditDto })
  auditRun(@Param("runId") runId: string) {
    return this.importExport.auditRun(runId);
  }
}

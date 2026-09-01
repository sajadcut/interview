import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { AuditedAction } from "../audit/audited-action.decorator";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { ApiStandardErrorResponses } from "../common/http/api-standard-error-responses.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import {
  LegalHoldDto,
  LegalHoldInputDto,
  MaintenanceExecutionDto,
  MaintenanceJobDto,
  SessionCleanupRequestDto,
} from "./maintenance.dto";
import { MaintenanceService } from "./maintenance.service";

@ApiTags("maintenance")
@Controller("v1")
@RequireTenant()
@RequirePermissions(Permissions.PrivacyManage)
@ApiStandardErrorResponses()
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Get("legal-holds")
  @ApiOkResponse({ type: LegalHoldDto, isArray: true })
  listLegalHolds() {
    return this.maintenance.listLegalHolds();
  }

  @Post("legal-holds")
  @AuditedAction("privacy.legal_hold.place", "legal_hold")
  @ApiOkResponse({ type: LegalHoldDto })
  createLegalHold(@Body() body: LegalHoldInputDto) {
    return this.maintenance.createLegalHold(body);
  }

  @Patch("legal-holds/:holdId/release")
  @AuditedAction("privacy.legal_hold.release", "legal_hold")
  @ApiOkResponse({ type: LegalHoldDto })
  releaseLegalHold(@Param("holdId") holdId: string) {
    return this.maintenance.releaseLegalHold(holdId);
  }

  @Post("maintenance/session-cleanup")
  @AuditedAction("maintenance.session_cleanup.run", "maintenance_job")
  @ApiOkResponse({ type: MaintenanceJobDto })
  sessionCleanup(@Body() body: SessionCleanupRequestDto) {
    return this.maintenance.sessionCleanup(body);
  }

  @Post("maintenance/retention")
  @AuditedAction("maintenance.retention.run", "maintenance_job")
  @ApiOkResponse({ type: MaintenanceJobDto })
  retention(@Body() body: MaintenanceExecutionDto) {
    return this.maintenance.runRetention(body);
  }

  @Post("privacy/requests/:requestId/execute-deletion")
  @AuditedAction("privacy.deletion.execute", "privacy_request")
  @ApiOkResponse({ type: MaintenanceJobDto })
  executePrivacyDeletion(
    @Param("requestId") requestId: string,
    @Body() body: MaintenanceExecutionDto,
  ) {
    return this.maintenance.executePrivacyDeletion(requestId, body);
  }
}

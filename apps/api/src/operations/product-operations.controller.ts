import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiCreatedResponse, ApiOkResponse, ApiQuery, ApiTags } from "@nestjs/swagger";
import { AuditedAction } from "../audit/audited-action.decorator";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import {
  AutomationApprovalResponseDto,
  AutomationRuleResponseDto,
  AutomationRunCreatedResponseDto,
  AutomationWorkspaceResponseDto,
  CreateAutomationRuleDto,
  CreateAutomationRunDto,
  CreateIntegrationDto,
  IntegrationConnectionResponseDto,
  OrganizationSettingsResponseDto,
  ProductAuditEventDto,
  ProductSearchResultDto,
  UpdateAutomationRuleDto,
  UpdateIntegrationDto,
  UpdateOrganizationSettingsDto,
} from "./product-operations.dto";
import { ProductOperationsService } from "./product-operations.service";

@ApiTags("product-operations")
@Controller("v1")
@RequireTenant()
export class ProductOperationsController {
  constructor(private readonly operations: ProductOperationsService) {}

  @Get("settings")
  @RequirePermissions(Permissions.OrganizationRead)
  @ApiOkResponse({ type: OrganizationSettingsResponseDto })
  getSettings() {
    return this.operations.getSettings();
  }

  @Patch("settings")
  @RequirePermissions(Permissions.SettingsManage)
  @AuditedAction("settings.update", "organization")
  @ApiOkResponse({ type: OrganizationSettingsResponseDto })
  updateSettings(@Body() body: UpdateOrganizationSettingsDto) {
    return this.operations.updateSettings(body);
  }

  @Get("integrations")
  @RequirePermissions(Permissions.IntegrationManage)
  @ApiOkResponse({ type: [IntegrationConnectionResponseDto] })
  listIntegrations() {
    return this.operations.listIntegrations();
  }

  @Post("integrations")
  @RequirePermissions(Permissions.IntegrationManage)
  @AuditedAction("integration.configure", "integration")
  @ApiCreatedResponse({ type: IntegrationConnectionResponseDto })
  createIntegration(@Body() body: CreateIntegrationDto) {
    return this.operations.createIntegration(body);
  }

  @Patch("integrations/:integrationId")
  @RequirePermissions(Permissions.IntegrationManage)
  @AuditedAction("integration.update", "integration")
  @ApiOkResponse({ type: IntegrationConnectionResponseDto })
  updateIntegration(
    @Param("integrationId") integrationId: string,
    @Body() body: UpdateIntegrationDto,
  ) {
    return this.operations.updateIntegration(integrationId, body);
  }

  @Get("automations")
  @RequirePermissions(Permissions.AutomationManage)
  @ApiOkResponse({ type: AutomationWorkspaceResponseDto })
  listAutomations() {
    return this.operations.listAutomations();
  }

  @Post("automations")
  @RequirePermissions(Permissions.AutomationManage)
  @AuditedAction("automation.create", "automation_rule")
  @ApiCreatedResponse({ type: AutomationRuleResponseDto })
  createAutomation(@Body() body: CreateAutomationRuleDto) {
    return this.operations.createAutomation(body);
  }

  @Patch("automations/:ruleId")
  @RequirePermissions(Permissions.AutomationManage)
  @AuditedAction("automation.update", "automation_rule")
  @ApiOkResponse({ type: AutomationRuleResponseDto })
  updateAutomation(@Param("ruleId") ruleId: string, @Body() body: UpdateAutomationRuleDto) {
    return this.operations.updateAutomation(ruleId, body);
  }

  @Post("automations/:ruleId/runs")
  @RequirePermissions(Permissions.AutomationManage)
  @AuditedAction("automation.run.create", "automation_rule")
  @ApiCreatedResponse({ type: AutomationRunCreatedResponseDto })
  createAutomationRun(@Param("ruleId") ruleId: string, @Body() body: CreateAutomationRunDto) {
    return this.operations.createAutomationRun(ruleId, body);
  }

  @Post("automation-runs/:runId/approve")
  @RequirePermissions(Permissions.AutomationManage)
  @AuditedAction("automation.run.approve", "automation_run")
  @ApiCreatedResponse({ type: AutomationApprovalResponseDto })
  approveAutomationRun(@Param("runId") runId: string) {
    return this.operations.approveAutomationRun(runId);
  }

  @Get("search")
  @ApiQuery({ name: "q", required: false, type: String })
  @ApiOkResponse({ type: [ProductSearchResultDto] })
  search(@Query("q") q = "") {
    return this.operations.search(q);
  }

  @Get("audit/events")
  @RequirePermissions(Permissions.AuditRead)
  @ApiQuery({ name: "action", required: false, type: String })
  @ApiQuery({ name: "entityType", required: false, type: String })
  @ApiQuery({ name: "limit", required: false, type: Number })
  @ApiOkResponse({ type: [ProductAuditEventDto] })
  listAuditEvents(
    @Query("action") action?: string,
    @Query("entityType") entityType?: string,
    @Query("limit") limit?: string,
  ) {
    const parsed = limit ? Number(limit) : 100;
    return this.operations.listAuditEvents(action, entityType, Number.isFinite(parsed) ? parsed : 100);
  }
}

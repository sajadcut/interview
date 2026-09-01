import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AuditedAction } from "../audit/audited-action.decorator";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import {
  CreateAutomationRuleDto,
  CreateAutomationRunDto,
  CreateIntegrationDto,
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
  getSettings() {
    return this.operations.getSettings();
  }

  @Patch("settings")
  @RequirePermissions(Permissions.SettingsManage)
  @AuditedAction("settings.update", "organization")
  updateSettings(@Body() body: UpdateOrganizationSettingsDto) {
    return this.operations.updateSettings(body);
  }

  @Get("integrations")
  @RequirePermissions(Permissions.IntegrationManage)
  listIntegrations() {
    return this.operations.listIntegrations();
  }

  @Post("integrations")
  @RequirePermissions(Permissions.IntegrationManage)
  @AuditedAction("integration.configure", "integration")
  createIntegration(@Body() body: CreateIntegrationDto) {
    return this.operations.createIntegration(body);
  }

  @Patch("integrations/:integrationId")
  @RequirePermissions(Permissions.IntegrationManage)
  @AuditedAction("integration.update", "integration")
  updateIntegration(
    @Param("integrationId") integrationId: string,
    @Body() body: UpdateIntegrationDto,
  ) {
    return this.operations.updateIntegration(integrationId, body);
  }

  @Get("automations")
  @RequirePermissions(Permissions.AutomationManage)
  listAutomations() {
    return this.operations.listAutomations();
  }

  @Post("automations")
  @RequirePermissions(Permissions.AutomationManage)
  @AuditedAction("automation.create", "automation_rule")
  createAutomation(@Body() body: CreateAutomationRuleDto) {
    return this.operations.createAutomation(body);
  }

  @Patch("automations/:ruleId")
  @RequirePermissions(Permissions.AutomationManage)
  @AuditedAction("automation.update", "automation_rule")
  updateAutomation(@Param("ruleId") ruleId: string, @Body() body: UpdateAutomationRuleDto) {
    return this.operations.updateAutomation(ruleId, body);
  }

  @Post("automations/:ruleId/runs")
  @RequirePermissions(Permissions.AutomationManage)
  @AuditedAction("automation.run.create", "automation_rule")
  createAutomationRun(@Param("ruleId") ruleId: string, @Body() body: CreateAutomationRunDto) {
    return this.operations.createAutomationRun(ruleId, body);
  }

  @Post("automation-runs/:runId/approve")
  @RequirePermissions(Permissions.AutomationManage)
  @AuditedAction("automation.run.approve", "automation_run")
  approveAutomationRun(@Param("runId") runId: string) {
    return this.operations.approveAutomationRun(runId);
  }

  @Get("search")
  search(@Query("q") q = "") {
    return this.operations.search(q);
  }

  @Get("audit/events")
  @RequirePermissions(Permissions.AuditRead)
  listAuditEvents(
    @Query("action") action?: string,
    @Query("entityType") entityType?: string,
    @Query("limit") limit?: string,
  ) {
    const parsed = limit ? Number(limit) : 100;
    return this.operations.listAuditEvents(action, entityType, Number.isFinite(parsed) ? parsed : 100);
  }
}

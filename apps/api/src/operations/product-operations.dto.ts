import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsIn, IsObject, IsOptional, IsString, Length } from "class-validator";

const openMap = { type: "object" as const, additionalProperties: true };

export class UpdateOrganizationSettingsDto {
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @Length(2, 16)
  defaultLocale?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @Length(1, 80)
  timezone?: string;

  @ApiPropertyOptional(openMap)
  @IsOptional()
  @IsObject()
  hiringPolicy?: Record<string, unknown>;

  @ApiPropertyOptional(openMap)
  @IsOptional()
  @IsObject()
  notificationPreferences?: Record<string, unknown>;
}

export class CreateIntegrationDto {
  @ApiProperty({ type: String })
  @IsString()
  @Length(1, 80)
  providerKey!: string;

  @ApiProperty({ type: String })
  @IsString()
  @Length(1, 80)
  connectionType!: string;

  @ApiPropertyOptional({ type: String, description: "Reference to an external secret; raw credentials are rejected." })
  @IsOptional()
  @IsString()
  @Length(1, 512)
  credentialReference?: string;

  @ApiPropertyOptional(openMap)
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

export class UpdateIntegrationDto {
  @ApiPropertyOptional({ enum: ["configured", "verified", "degraded", "disabled"] })
  @IsOptional()
  @IsIn(["configured", "verified", "degraded", "disabled"])
  status?: "configured" | "verified" | "degraded" | "disabled";

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @Length(1, 512)
  credentialReference?: string;

  @ApiPropertyOptional(openMap)
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

export class CreateAutomationRuleDto {
  @ApiProperty({ type: String })
  @IsString()
  @Length(1, 240)
  name!: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @Length(1, 4000)
  description?: string;

  @ApiProperty({ type: String })
  @IsString()
  @Length(1, 80)
  triggerType!: string;

  @ApiPropertyOptional(openMap)
  @IsOptional()
  @IsObject()
  triggerConfig?: Record<string, unknown>;

  @ApiProperty({ type: String })
  @IsString()
  @Length(1, 80)
  actionType!: string;

  @ApiPropertyOptional(openMap)
  @IsOptional()
  @IsObject()
  actionConfig?: Record<string, unknown>;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @IsBoolean()
  approvalRequired?: boolean;
}

export class UpdateAutomationRuleDto {
  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @IsBoolean()
  approvalRequired?: boolean;
}

export class CreateAutomationRunDto {
  @ApiProperty({ type: String })
  @IsString()
  @Length(8, 512)
  idempotencyKey!: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @Length(1, 512)
  triggerReference?: string;

  @ApiPropertyOptional(openMap)
  @IsOptional()
  @IsObject()
  input?: Record<string, unknown>;
}

export class OrganizationSettingsResponseDto {
  @ApiProperty({ type: String }) organization_id!: string;
  @ApiProperty({ type: String }) default_locale!: string;
  @ApiProperty({ type: String }) timezone!: string;
  @ApiProperty(openMap) hiring_policy!: Record<string, unknown>;
  @ApiProperty(openMap) notification_preferences!: Record<string, unknown>;
  @ApiPropertyOptional({ type: String, nullable: true }) updated_by_user_id?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, format: "date-time" }) updated_at?: string | null;
}

export class IntegrationConnectionResponseDto {
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) provider_key!: string;
  @ApiProperty({ type: String }) connection_type!: string;
  @ApiProperty({ enum: ["configured", "verified", "degraded", "disabled"] }) status!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) credential_reference?: string | null;
  @ApiProperty(openMap) config!: Record<string, unknown>;
  @ApiPropertyOptional({ type: String, nullable: true, format: "date-time" }) last_verified_at?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) last_error?: string | null;
  @ApiProperty({ type: String, format: "date-time" }) created_at!: string;
  @ApiProperty({ type: String, format: "date-time" }) updated_at!: string;
}

export class AutomationRuleResponseDto {
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) description?: string | null;
  @ApiProperty({ type: String }) trigger_type!: string;
  @ApiPropertyOptional(openMap) trigger_config?: Record<string, unknown>;
  @ApiProperty({ type: String }) action_type!: string;
  @ApiPropertyOptional(openMap) action_config?: Record<string, unknown>;
  @ApiProperty({ type: Boolean }) approval_required!: boolean;
  @ApiProperty({ type: Boolean }) enabled!: boolean;
  @ApiProperty({ type: String, format: "date-time" }) created_at!: string;
  @ApiProperty({ type: String, format: "date-time" }) updated_at!: string;
}

export class AutomationRunResponseDto {
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) rule_id!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) trigger_reference?: string | null;
  @ApiProperty({ type: String }) idempotency_key!: string;
  @ApiProperty({ type: String }) state!: string;
  @ApiPropertyOptional(openMap) input?: Record<string, unknown>;
  @ApiPropertyOptional({ ...openMap, nullable: true }) output?: Record<string, unknown> | null;
  @ApiPropertyOptional({ type: String, nullable: true }) error_message?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, format: "date-time" }) approved_at?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, format: "date-time" }) started_at?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, format: "date-time" }) completed_at?: string | null;
  @ApiProperty({ type: String, format: "date-time" }) created_at!: string;
}

export class AutomationWorkspaceResponseDto {
  @ApiProperty({ type: [AutomationRuleResponseDto] }) rules!: AutomationRuleResponseDto[];
  @ApiProperty({ type: [AutomationRunResponseDto] }) runs!: AutomationRunResponseDto[];
}

export class AutomationRunCreatedResponseDto extends AutomationRunResponseDto {
  @ApiProperty({ type: String }) executionBoundary!: string;
}

export class AutomationApprovalResponseDto {
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) rule_id!: string;
  @ApiProperty({ type: String }) state!: string;
  @ApiProperty({ type: String }) approved_by_user_id!: string;
  @ApiProperty({ type: String, format: "date-time" }) approved_at!: string;
}

export class ProductSearchResultDto {
  @ApiProperty({ enum: ["job", "candidate", "interview"] }) type!: string;
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) title!: string;
  @ApiPropertyOptional({ type: String }) subtitle?: string;
  @ApiProperty({ type: String }) href!: string;
}

export class ProductAuditEventDto {
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) actor_type!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) actor_user_id?: string | null;
  @ApiProperty({ type: String }) action!: string;
  @ApiProperty({ type: String }) entity_type!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) entity_id?: string | null;
  @ApiPropertyOptional({ ...openMap, nullable: true }) metadata?: Record<string, unknown> | null;
  @ApiProperty({ type: String, format: "date-time" }) created_at!: string;
}

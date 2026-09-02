import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsIn, IsObject, IsOptional, IsString, Length } from "class-validator";

export class UpdateOrganizationSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 16)
  defaultLocale?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 80)
  timezone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  hiringPolicy?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  notificationPreferences?: Record<string, unknown>;
}

export class CreateIntegrationDto {
  @ApiProperty()
  @IsString()
  @Length(1, 80)
  providerKey!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 80)
  connectionType!: string;

  @ApiPropertyOptional({ description: "Reference to an external secret; raw credentials are rejected." })
  @IsOptional()
  @IsString()
  @Length(1, 512)
  credentialReference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

export class UpdateIntegrationDto {
  @ApiPropertyOptional({ enum: ["configured", "verified", "degraded", "disabled"] })
  @IsOptional()
  @IsIn(["configured", "verified", "degraded", "disabled"])
  status?: "configured" | "verified" | "degraded" | "disabled";

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 512)
  credentialReference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

export class CreateAutomationRuleDto {
  @ApiProperty()
  @IsString()
  @Length(1, 240)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 4000)
  description?: string;

  @ApiProperty()
  @IsString()
  @Length(1, 80)
  triggerType!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  triggerConfig?: Record<string, unknown>;

  @ApiProperty()
  @IsString()
  @Length(1, 80)
  actionType!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  actionConfig?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  approvalRequired?: boolean;
}

export class UpdateAutomationRuleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  approvalRequired?: boolean;
}

export class CreateAutomationRunDto {
  @ApiProperty()
  @IsString()
  @Length(8, 512)
  idempotencyKey!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 512)
  triggerReference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  input?: Record<string, unknown>;
}

export class OrganizationSettingsResponseDto {
  @ApiProperty() organization_id!: string;
  @ApiProperty() default_locale!: string;
  @ApiProperty() timezone!: string;
  @ApiProperty({ type: Object }) hiring_policy!: Record<string, unknown>;
  @ApiProperty({ type: Object }) notification_preferences!: Record<string, unknown>;
  @ApiPropertyOptional({ nullable: true }) updated_by_user_id?: string | null;
  @ApiPropertyOptional({ nullable: true, format: "date-time" }) updated_at?: string | null;
}

export class IntegrationConnectionResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() provider_key!: string;
  @ApiProperty() connection_type!: string;
  @ApiProperty({ enum: ["configured", "verified", "degraded", "disabled"] }) status!: string;
  @ApiPropertyOptional({ nullable: true }) credential_reference?: string | null;
  @ApiProperty({ type: Object }) config!: Record<string, unknown>;
  @ApiPropertyOptional({ nullable: true, format: "date-time" }) last_verified_at?: string | null;
  @ApiPropertyOptional({ nullable: true }) last_error?: string | null;
  @ApiProperty({ format: "date-time" }) created_at!: string;
  @ApiProperty({ format: "date-time" }) updated_at!: string;
}

export class AutomationRuleResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional({ nullable: true }) description?: string | null;
  @ApiProperty() trigger_type!: string;
  @ApiPropertyOptional({ type: Object }) trigger_config?: Record<string, unknown>;
  @ApiProperty() action_type!: string;
  @ApiPropertyOptional({ type: Object }) action_config?: Record<string, unknown>;
  @ApiProperty() approval_required!: boolean;
  @ApiProperty() enabled!: boolean;
  @ApiProperty({ format: "date-time" }) created_at!: string;
  @ApiProperty({ format: "date-time" }) updated_at!: string;
}

export class AutomationRunResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() rule_id!: string;
  @ApiPropertyOptional({ nullable: true }) trigger_reference?: string | null;
  @ApiProperty() idempotency_key!: string;
  @ApiProperty() state!: string;
  @ApiPropertyOptional({ type: Object }) input?: Record<string, unknown>;
  @ApiPropertyOptional({ type: Object, nullable: true }) output?: Record<string, unknown> | null;
  @ApiPropertyOptional({ nullable: true }) error_message?: string | null;
  @ApiPropertyOptional({ nullable: true, format: "date-time" }) approved_at?: string | null;
  @ApiPropertyOptional({ nullable: true, format: "date-time" }) started_at?: string | null;
  @ApiPropertyOptional({ nullable: true, format: "date-time" }) completed_at?: string | null;
  @ApiProperty({ format: "date-time" }) created_at!: string;
}

export class AutomationWorkspaceResponseDto {
  @ApiProperty({ type: [AutomationRuleResponseDto] }) rules!: AutomationRuleResponseDto[];
  @ApiProperty({ type: [AutomationRunResponseDto] }) runs!: AutomationRunResponseDto[];
}

export class AutomationRunCreatedResponseDto extends AutomationRunResponseDto {
  @ApiProperty() executionBoundary!: string;
}

export class AutomationApprovalResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() rule_id!: string;
  @ApiProperty() state!: string;
  @ApiProperty() approved_by_user_id!: string;
  @ApiProperty({ format: "date-time" }) approved_at!: string;
}

export class ProductSearchResultDto {
  @ApiProperty({ enum: ["job", "candidate", "interview"] }) type!: string;
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiPropertyOptional() subtitle?: string;
  @ApiProperty() href!: string;
}

export class ProductAuditEventDto {
  @ApiProperty() id!: string;
  @ApiProperty() actor_type!: string;
  @ApiPropertyOptional({ nullable: true }) actor_user_id?: string | null;
  @ApiProperty() action!: string;
  @ApiProperty() entity_type!: string;
  @ApiPropertyOptional({ nullable: true }) entity_id?: string | null;
  @ApiPropertyOptional({ type: Object, nullable: true }) metadata?: Record<string, unknown> | null;
  @ApiProperty({ format: "date-time" }) created_at!: string;
}

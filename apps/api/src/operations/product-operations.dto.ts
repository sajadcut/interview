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

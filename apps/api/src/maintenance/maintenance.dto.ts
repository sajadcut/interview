import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from "class-validator";

export class MaintenanceExecutionDto {
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @ApiPropertyOptional({ minLength: 8, maxLength: 200 })
  @IsOptional()
  @IsString()
  @Length(8, 200)
  idempotencyKey?: string;
}

export class SessionCleanupRequestDto extends MaintenanceExecutionDto {
  @ApiPropertyOptional({ minimum: 0, maximum: 365, default: 7 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  graceDays?: number;
}

export class LegalHoldInputDto {
  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  candidateId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 80)
  entityType?: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  entityId?: string;

  @ApiProperty()
  @IsString()
  @Length(3, 4000)
  reason!: string;
}

export class LegalHoldDto {
  @ApiProperty() id!: string;
  @ApiPropertyOptional() candidateId?: string;
  @ApiPropertyOptional() entityType?: string;
  @ApiPropertyOptional() entityId?: string;
  @ApiProperty() reason!: string;
  @ApiProperty() status!: string;
  @ApiProperty() placedAt!: string;
  @ApiPropertyOptional() releasedAt?: string;
}

export class MaintenanceJobDto {
  @ApiProperty() id!: string;
  @ApiProperty() jobType!: string;
  @ApiProperty() state!: string;
  @ApiProperty() dryRun!: boolean;
  @ApiProperty({ type: Object }) result!: Record<string, unknown>;
  @ApiPropertyOptional() errorMessage?: string;
  @ApiProperty() startedAt!: string;
  @ApiPropertyOptional() completedAt?: string;
}

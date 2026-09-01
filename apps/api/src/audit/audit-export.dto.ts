import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsDateString, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

export class AuditExportQueryDto {
  @ApiPropertyOptional({ format: "date-time" })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ format: "date-time" })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ maxLength: 160 })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  action?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  entityType?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 10_000, default: 1_000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  limit?: number;
}

export class AuditExportEventDto {
  @ApiProperty() id!: string;
  @ApiProperty() actorType!: string;
  @ApiPropertyOptional() actorUserId?: string | null;
  @ApiProperty() action!: string;
  @ApiProperty() entityType!: string;
  @ApiPropertyOptional() entityId?: string | null;
  @ApiPropertyOptional() reason?: string | null;
  @ApiPropertyOptional({ type: Object }) before?: Record<string, unknown> | null;
  @ApiPropertyOptional({ type: Object }) after?: Record<string, unknown> | null;
  @ApiPropertyOptional({ type: Object }) metadata?: Record<string, unknown> | null;
  @ApiProperty({ format: "date-time" }) createdAt!: string;
}

export class AuditExportDto {
  @ApiProperty({ format: "date-time" }) exportedAt!: string;
  @ApiProperty({ format: "uuid" }) organizationId!: string;
  @ApiProperty({ type: Object }) filters!: Record<string, unknown>;
  @ApiProperty() count!: number;
  @ApiProperty() truncated!: boolean;
  @ApiProperty({ type: [AuditExportEventDto] }) events!: AuditExportEventDto[];
}

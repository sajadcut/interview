import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsInt, IsObject, IsOptional, IsString, IsUUID, Length, Max, Min } from "class-validator";

export class ClaimAiJobDto {
  @ApiProperty({ type: String })
  @IsString()
  @Length(1, 160)
  workerId!: string;

  @ApiPropertyOptional({ type: Number, minimum: 5000, maximum: 300000 })
  @IsOptional()
  @IsInt()
  @Min(5000)
  @Max(300000)
  leaseDurationMs?: number;
}

export class AiJobLeaseDto {
  @ApiProperty({ type: String, format: "uuid" })
  @IsUUID()
  leaseToken!: string;

  @ApiProperty({ type: String })
  @IsString()
  @Length(1, 160)
  workerId!: string;
}

export class HeartbeatAiJobDto extends AiJobLeaseDto {
  @ApiPropertyOptional({ type: Number, minimum: 5000, maximum: 300000 })
  @IsOptional()
  @IsInt()
  @Min(5000)
  @Max(300000)
  leaseDurationMs?: number;
}

export class CompleteAiJobDto extends AiJobLeaseDto {
  @ApiProperty({ type: Object })
  @IsObject()
  result!: Record<string, unknown>;
}

export class FailAiJobDto extends AiJobLeaseDto {
  @ApiProperty({ type: Boolean })
  @IsBoolean()
  retryable!: boolean;

  @ApiProperty({ type: String })
  @IsString()
  @Length(1, 120)
  errorCode!: string;

  @ApiProperty({ type: String })
  @IsString()
  @Length(1, 4000)
  errorMessage!: string;
}

import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from "class-validator";

export class ClaimPrivacyDeletionJobDto {
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

export class PrivacyDeletionLeaseDto {
  @ApiProperty({ type: String, format: "uuid" })
  @IsUUID()
  leaseToken!: string;

  @ApiProperty({ type: String })
  @IsString()
  @Length(1, 160)
  workerId!: string;
}

export class HeartbeatPrivacyDeletionJobDto extends PrivacyDeletionLeaseDto {
  @ApiPropertyOptional({ type: Number, minimum: 5000, maximum: 300000 })
  @IsOptional()
  @IsInt()
  @Min(5000)
  @Max(300000)
  leaseDurationMs?: number;
}

export class ExecutePrivacyDeletionJobDto extends PrivacyDeletionLeaseDto {}

export class FailPrivacyDeletionJobDto extends PrivacyDeletionLeaseDto {
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

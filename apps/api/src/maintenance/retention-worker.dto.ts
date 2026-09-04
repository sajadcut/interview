import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from "class-validator";

export class ScheduleRetentionJobsDto {
  @IsString()
  @Length(4, 120)
  cycleKey!: string;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

export class ClaimRetentionJobDto {
  @IsString()
  @Length(1, 160)
  workerId!: string;

  @IsOptional()
  @IsInt()
  @Min(5000)
  @Max(300000)
  leaseDurationMs?: number;
}

export class RetentionJobLeaseDto {
  @IsUUID()
  leaseToken!: string;

  @IsString()
  @Length(1, 160)
  workerId!: string;
}

export class HeartbeatRetentionJobDto extends RetentionJobLeaseDto {
  @IsOptional()
  @IsInt()
  @Min(5000)
  @Max(300000)
  leaseDurationMs?: number;
}

export class FailRetentionJobDto extends RetentionJobLeaseDto {
  @IsBoolean()
  retryable!: boolean;

  @IsString()
  @Length(1, 120)
  errorCode!: string;

  @IsString()
  @Length(1, 4000)
  errorMessage!: string;
}

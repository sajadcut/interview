import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from "class-validator";
import { ApprovedSourceTypes, type ApprovedSourceType } from "./candidate-source.adapter";

const sourceTypes = Object.values(ApprovedSourceTypes);

export class TalentCandidateDto {
  @ApiProperty() candidateId!: string;
  @ApiProperty() displayName!: string;
  @ApiPropertyOptional() currentRole?: string;
  @ApiPropertyOptional() currentCompany?: string;
  @ApiProperty({ type: [String] }) skills!: string[];
  @ApiProperty({ type: [String] }) tags!: string[];
  @ApiProperty() status!: string;
  @ApiProperty() updatedAt!: string;
}

export class SourcingRunSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty() jobId!: string;
  @ApiProperty() status!: string;
  @ApiProperty({ enum: sourceTypes }) requestedSourceType!: ApprovedSourceType;
  @ApiProperty() attemptCount!: number;
  @ApiProperty() resultCount!: number;
  @ApiPropertyOptional() errorMessage?: string;
  @ApiProperty() createdAt!: string;
}

export class SourcingAttemptDto {
  @ApiProperty() attemptNo!: number;
  @ApiProperty({ enum: sourceTypes }) sourceType!: ApprovedSourceType;
  @ApiProperty() providerKey!: string;
  @ApiProperty() state!: string;
  @ApiProperty() resultCount!: number;
  @ApiPropertyOptional() errorMessage?: string;
  @ApiProperty() startedAt!: string;
  @ApiPropertyOptional() completedAt?: string;
}

export class DiscoveredCandidateDto {
  @ApiProperty() id!: string;
  @ApiPropertyOptional() candidateId?: string;
  @ApiProperty({ enum: sourceTypes }) sourceType!: ApprovedSourceType;
  @ApiPropertyOptional() retrievalScore?: number;
  @ApiPropertyOptional() preInterviewMatchScore?: number;
  @ApiProperty() dedupeState!: string;
  @ApiProperty() reviewState!: string;
  @ApiProperty({ type: Object }) profileSnapshot!: Record<string, unknown>;
  @ApiProperty({ type: Object }) sourceProvenance!: Record<string, unknown>;
  @ApiPropertyOptional() sourceObservedAt?: string;
}

export class SourcingRunDetailDto extends SourcingRunSummaryDto {
  @ApiProperty() sourcePolicyVersion!: string;
  @ApiPropertyOptional() idempotencyKey?: string;
  @ApiProperty({ type: Object }) strategy!: Record<string, unknown>;
  @ApiProperty({ type: [DiscoveredCandidateDto] }) results!: DiscoveredCandidateDto[];
  @ApiProperty({ type: [SourcingAttemptDto] }) attempts!: SourcingAttemptDto[];
  @ApiProperty({ description: "Retrieval scores are search signals, not hiring scores." })
  retrievalNotice!: string;
}

export class SourcingRunExecutionDto extends SourcingRunDetailDto {
  @ApiProperty() idempotentReplay!: boolean;
  @ApiPropertyOptional() providerKey?: string;
}

export class SourcingRunRequestDto {
  @ApiProperty()
  @IsString()
  @Length(1, 1000)
  query!: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ enum: sourceTypes, default: ApprovedSourceTypes.InternalTalentPool })
  @IsOptional()
  @IsIn(sourceTypes)
  sourceType?: ApprovedSourceType;

  @ApiPropertyOptional({
    description: "Provider selector for provider-backed source types. approved_external currently supports people_data_labs and coresignal.",
    minLength: 2,
    maxLength: 80,
  })
  @IsOptional()
  @IsString()
  @Length(2, 80)
  providerKey?: string;

  @ApiPropertyOptional({ minLength: 8, maxLength: 200 })
  @IsOptional()
  @IsString()
  @Length(8, 200)
  idempotencyKey?: string;

  @ApiPropertyOptional({
    description: "Required for adapters whose source policy requires explicit human approval.",
  })
  @IsOptional()
  @IsBoolean()
  approvalConfirmed?: boolean;
}

export class SourcingRetryRequestDto {
  @ApiPropertyOptional({
    description: "Required again when retrying an approval-gated external source.",
  })
  @IsOptional()
  @IsBoolean()
  approvalConfirmed?: boolean;
}

export class SourcingSourceCapabilityDto {
  @ApiProperty({ enum: sourceTypes }) sourceType!: ApprovedSourceType;
  @ApiProperty() configured!: boolean;
  @ApiProperty() requiresApproval!: boolean;
  @ApiPropertyOptional() providerKey?: string;
}

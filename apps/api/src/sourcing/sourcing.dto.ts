import { ApiHideProperty, ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
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

  @ApiHideProperty()
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


export class JobTalentMatchDto {
  @ApiProperty({ format: "uuid" }) candidateId!: string;
  @ApiProperty() displayName!: string;
  @ApiPropertyOptional() currentRole?: string;
  @ApiPropertyOptional() currentCompany?: string;
  @ApiProperty({ type: [String] }) skills!: string[];
  @ApiProperty({ minimum: 0, maximum: 100 }) matchScore!: number;
  @ApiProperty() algorithmVersion!: string;
  @ApiProperty({ type: [String] }) matchedRequirements!: string[];
  @ApiProperty({ type: [String] }) missingMustHaveRequirements!: string[];
  @ApiPropertyOptional({ format: "uuid" }) applicationId?: string;
}

export class JobTalentMatchExplanationDto {
  @ApiProperty({ format: "uuid" }) candidateId!: string;
  @ApiProperty() fitSummary!: string;
  @ApiProperty({ type: [String] }) strengths!: string[];
  @ApiProperty({ type: [String] }) gaps!: string[];
  @ApiProperty({ minimum: 0, maximum: 1 }) confidence!: number;
}

export class JobTalentAnalysisStartDto {
  @ApiProperty({ format: "uuid" }) analysisJobId!: string;
  @ApiProperty() status!: string;
}

export class JobTalentAnalysisStatusDto {
  @ApiProperty({ format: "uuid" }) analysisJobId!: string;
  @ApiProperty() status!: string;
  @ApiPropertyOptional({ type: [JobTalentMatchExplanationDto] }) matches?: JobTalentMatchExplanationDto[];
  @ApiPropertyOptional() errorMessage?: string;
}

export class CandidateFinderStartDto {
  @ApiProperty({ format: "uuid" }) planJobId!: string;
  @ApiProperty() status!: string;
}

export class CandidateFinderToolCallDto {
  @ApiProperty({ enum: sourceTypes }) sourceType!: ApprovedSourceType;
  @ApiPropertyOptional() providerKey?: string;
  @ApiProperty() query!: string;
  @ApiProperty({ minimum: 1, maximum: 100 }) limit!: number;
}

export class CandidateFinderPlanStatusDto {
  @ApiProperty({ format: "uuid" }) planJobId!: string;
  @ApiProperty() status!: string;
  @ApiPropertyOptional() rationale?: string;
  @ApiPropertyOptional({ type: [CandidateFinderToolCallDto] }) toolCalls?: CandidateFinderToolCallDto[];
  @ApiPropertyOptional() errorMessage?: string;
}

export class CandidateFinderExecuteDto {
  @ApiPropertyOptional({
    description: "Required when the generated plan uses ATS or external providers.",
  })
  @IsOptional()
  @IsBoolean()
  approvalConfirmed?: boolean;
}

export class CandidateFinderExecutionDto {
  @ApiProperty({ format: "uuid" }) planJobId!: string;
  @ApiProperty({ type: [SourcingRunExecutionDto] }) runs!: SourcingRunExecutionDto[];
}

export class AcceptedDiscoveredCandidateDto {
  @ApiProperty({ format: "uuid" }) discoveredCandidateId!: string;
  @ApiProperty({ format: "uuid" }) candidateId!: string;
  @ApiProperty({ format: "uuid" }) applicationId!: string;
  @ApiProperty({ minimum: 0, maximum: 100 }) preInterviewMatchScore!: number;
  @ApiProperty() importedCandidate!: boolean;
  @ApiProperty() applicationAlreadyExisted!: boolean;
}

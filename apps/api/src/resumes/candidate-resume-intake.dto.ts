import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ResumeDto } from "./resume-ingestion.dto";

export class CandidateJobMatchDto {
  @ApiProperty({ format: "uuid" }) jobId!: string;
  @ApiProperty() jobTitle!: string;
  @ApiProperty() jobStatus!: string;
  @ApiPropertyOptional() department?: string;
  @ApiPropertyOptional() location?: string;
  @ApiPropertyOptional() seniority?: string;
  @ApiProperty({ minimum: 0, maximum: 100 }) matchScore!: number;
  @ApiProperty() algorithmVersion!: string;
  @ApiProperty({ type: [String] }) matchedRequirements!: string[];
  @ApiProperty({ type: [String] }) missingMustHaveRequirements!: string[];
  @ApiProperty() rubricPublished!: boolean;
  @ApiPropertyOptional({ format: "uuid" }) applicationId?: string;
}

export class CandidateResumeIntakeDto {
  @ApiProperty({ format: "uuid" }) candidateId!: string;
  @ApiProperty() candidateDisplayName!: string;
  @ApiProperty() reusedExistingCandidate!: boolean;
  @ApiProperty({ type: ResumeDto }) resume!: ResumeDto;
  @ApiProperty({ type: [CandidateJobMatchDto] }) matches!: CandidateJobMatchDto[];
  @ApiPropertyOptional({ format: "uuid" }) analysisJobId?: string;
}

export class CandidateJobMatchAnalysisDto {
  @ApiProperty({ format: "uuid" }) jobId!: string;
  @ApiProperty() fitSummary!: string;
  @ApiProperty({ type: [String] }) strengths!: string[];
  @ApiProperty({ type: [String] }) gaps!: string[];
  @ApiProperty({ minimum: 0, maximum: 1 }) confidence!: number;
}

export class CandidateJobMatchAnalysisStatusDto {
  @ApiProperty({ format: "uuid" }) analysisJobId!: string;
  @ApiProperty() status!: string;
  @ApiPropertyOptional({ type: [CandidateJobMatchAnalysisDto] }) matches?: CandidateJobMatchAnalysisDto[];
  @ApiPropertyOptional() errorMessage?: string;
}

export class CandidateMatchApplicationDto {
  @ApiProperty({ format: "uuid" }) applicationId!: string;
  @ApiProperty({ format: "uuid" }) candidateId!: string;
  @ApiProperty({ format: "uuid" }) jobId!: string;
  @ApiProperty({ minimum: 0, maximum: 100 }) preInterviewMatchScore!: number;
  @ApiProperty() pipelineStage!: string;
  @ApiProperty() alreadyExisted!: boolean;
}

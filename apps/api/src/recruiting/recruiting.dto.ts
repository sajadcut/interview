import { Type } from "class-transformer";
import { ArrayMinSize, IsArray, IsNumber, IsUUID, Max, Min, ValidateNested } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class JobSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() status!: string;
  @ApiPropertyOptional() department?: string;
  @ApiPropertyOptional() location?: string;
  @ApiPropertyOptional() seniority?: string;
  @ApiProperty() applicationCount!: number;
  @ApiProperty() interviewCount!: number;
  @ApiProperty() updatedAt!: string;
}

export class CandidateSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty() displayName!: string;
  @ApiPropertyOptional() currentRole?: string;
  @ApiPropertyOptional() currentCompany?: string;
  @ApiPropertyOptional() location?: string;
  @ApiPropertyOptional() applicationId?: string;
  @ApiPropertyOptional() pipelineStage?: string;
  @ApiPropertyOptional() preInterviewMatchScore?: number;
  @ApiProperty({ type: [String] }) skills!: string[];
  @ApiProperty() updatedAt!: string;
}

export class RequirementDto {
  @ApiProperty() id!: string;
  @ApiProperty() requirementType!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional() description?: string;
  @ApiProperty() weight!: number;
  @ApiPropertyOptional() minimumYears?: number;
}

export class RubricCriterionDto {
  @ApiProperty() id!: string;
  @ApiProperty() criterionKey!: string;
  @ApiProperty() label!: string;
  @ApiProperty() weight!: number;
  @ApiProperty() required!: boolean;
  @ApiProperty() displayOrder!: number;
}

export class PipelineCountDto {
  @ApiProperty() stage!: string;
  @ApiProperty() count!: number;
}

export class JobWorkspaceDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() status!: string;
  @ApiPropertyOptional() department?: string;
  @ApiPropertyOptional() location?: string;
  @ApiPropertyOptional() seniority?: string;
  @ApiPropertyOptional() summary?: string;
  @ApiProperty({ type: [RequirementDto] }) requirements!: RequirementDto[];
  @ApiProperty({ type: [RubricCriterionDto] }) rubricCriteria!: RubricCriterionDto[];
  @ApiProperty({ type: [PipelineCountDto] }) pipeline!: PipelineCountDto[];
}

export class CandidateSkillDto {
  @ApiProperty() id!: string;
  @ApiProperty() skillKey!: string;
  @ApiProperty() skillLabel!: string;
  @ApiProperty() verificationState!: string;
  @ApiPropertyOptional() confidence?: number;
  @ApiPropertyOptional() sourceReference?: string;
}

export class CandidateApplicationDto {
  @ApiProperty() id!: string;
  @ApiProperty() jobId!: string;
  @ApiProperty() rubricVersionId!: string;
  @ApiProperty() jobTitle!: string;
  @ApiProperty() status!: string;
  @ApiProperty() pipelineStage!: string;
  @ApiPropertyOptional() source?: string;
  @ApiPropertyOptional() preInterviewMatchScore?: number;
}

export class CandidateWorkspaceDto {
  @ApiProperty() id!: string;
  @ApiProperty() displayName!: string;
  @ApiPropertyOptional() primaryEmail?: string;
  @ApiPropertyOptional() primaryPhone?: string;
  @ApiPropertyOptional() currentRole?: string;
  @ApiPropertyOptional() currentCompany?: string;
  @ApiPropertyOptional() location?: string;
  @ApiPropertyOptional() preferredLanguage?: string;
  @ApiProperty({ type: [CandidateSkillDto] }) skills!: CandidateSkillDto[];
  @ApiProperty({ type: [CandidateApplicationDto] }) applications!: CandidateApplicationDto[];
}

export class PreviewScoreCriterionDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  criterionId!: string;

  @ApiProperty({ minimum: 0.001 })
  @IsNumber()
  @Min(0.001)
  weight!: number;

  @ApiProperty({ minimum: 0, maximum: 100 })
  @IsNumber()
  @Min(0)
  @Max(100)
  score!: number;

  @ApiProperty({ type: [String], format: "uuid" })
  @IsArray()
  @IsUUID(undefined, { each: true })
  evidenceIds!: string[];
}

export class PreviewScorecardDto {
  @ApiProperty({ type: [PreviewScoreCriterionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PreviewScoreCriterionDto)
  criteria!: PreviewScoreCriterionDto[];
}

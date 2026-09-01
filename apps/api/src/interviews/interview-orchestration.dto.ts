import { Type } from "class-transformer";
import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class GenerateInterviewPlanDto {
  @ApiPropertyOptional({ default: "en" })
  @IsOptional()
  @IsString()
  @Length(2, 24)
  language?: string;

  @ApiPropertyOptional({ default: "structured_competency" })
  @IsOptional()
  @IsString()
  @Length(2, 80)
  interviewType?: string;

  @ApiPropertyOptional({ minimum: 5, maximum: 180, default: 45 })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(180)
  timeBudgetMinutes?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 10, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  minDepth?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 10, default: 3 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  maxDepth?: number;

  @ApiPropertyOptional({ default: "interviewer-policy-v1" })
  @IsOptional()
  @IsString()
  @Length(1, 80)
  interviewerPolicyVersion?: string;

  @ApiPropertyOptional({ default: "pre-realtime-contract-v1" })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  speechAvatarStackVersion?: string;

  @ApiPropertyOptional({ default: "evidence-evaluator-v1" })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  evaluatorVersion?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  forbiddenTopics?: string[];
}

export class InterviewPlanGeneratedDto {
  @ApiProperty() id!: string;
  @ApiProperty() jobId!: string;
  @ApiProperty() rubricVersionId!: string;
  @ApiProperty() releaseUnitId!: string;
  @ApiProperty() version!: number;
  @ApiProperty() status!: string;
  @ApiProperty() language!: string;
  @ApiProperty() interviewType!: string;
  @ApiProperty() timeBudgetMinutes!: number;
  @ApiProperty({ type: Object }) questionStrategy!: Record<string, unknown>;
}

export class EvaluatorCriterionBenchmarkDto {
  @ApiProperty()
  @IsString()
  @Length(1, 120)
  criterionKey!: string;

  @ApiProperty({ minimum: 0, maximum: 100 })
  @IsNumber()
  @Min(0)
  @Max(100)
  score!: number;
}

export class CreateEvaluatorCalibrationCaseDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  rubricVersionId!: string;

  @ApiProperty()
  @IsString()
  @Length(3, 240)
  name!: string;

  @ApiProperty({ type: [Object], description: "Final transcript fixture segments used for deterministic evaluator testing." })
  @IsArray()
  transcriptFixture!: Record<string, unknown>[];

  @ApiProperty({ type: [EvaluatorCriterionBenchmarkDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EvaluatorCriterionBenchmarkDto)
  expectedCriteria!: EvaluatorCriterionBenchmarkDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 48)
  expectedRecommendation?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 100, default: 10 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  tolerance?: number;
}

export class RecordEvaluatorCalibrationRunDto {
  @ApiProperty()
  @IsString()
  @Length(1, 120)
  evaluatorVersion!: string;

  @ApiProperty({ type: [EvaluatorCriterionBenchmarkDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EvaluatorCriterionBenchmarkDto)
  criterionResults!: EvaluatorCriterionBenchmarkDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 48)
  recommendation?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 4000)
  notes?: string;
}

export class EvaluatorCalibrationRunDto {
  @ApiProperty() id!: string;
  @ApiProperty() caseId!: string;
  @ApiProperty() evaluatorVersion!: string;
  @ApiPropertyOptional() meanAbsoluteScoreDelta?: number;
  @ApiProperty() recommendationAgreement!: boolean;
  @ApiProperty() withinTolerance!: boolean;
  @ApiProperty() createdAt!: string;
}

export class EvaluatorCalibrationSummaryDto {
  @ApiProperty() evaluatorVersion!: string;
  @ApiProperty() runCount!: number;
  @ApiProperty() withinToleranceRate!: number;
  @ApiProperty() recommendationAgreementRate!: number;
  @ApiPropertyOptional() meanAbsoluteScoreDelta?: number;
}

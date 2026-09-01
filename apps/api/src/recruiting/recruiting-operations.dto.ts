import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsIn,
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

export class CreateJobRequirementDto {
  @ApiProperty({ enum: ["must_have", "nice_to_have"] })
  @IsIn(["must_have", "nice_to_have"])
  requirementType!: "must_have" | "nice_to_have";

  @ApiProperty()
  @IsString()
  @Length(1, 240)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ minimum: 0.001 })
  @IsNumber()
  @Min(0.001)
  weight!: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minimumYears?: number;
}

export class CreateRubricCriterionDto {
  @ApiProperty()
  @IsString()
  @Length(1, 120)
  criterionKey!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 240)
  label!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ minimum: 0.001 })
  @IsNumber()
  @Min(0.001)
  weight!: number;

  @ApiProperty({ default: true })
  @IsBoolean()
  required!: boolean;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  displayOrder!: number;
}

export class CreateJobDto {
  @ApiProperty()
  @IsString()
  @Length(1, 240)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 160)
  department?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 240)
  location?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 80)
  seniority?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  summary?: string;

  @ApiProperty({ type: [CreateJobRequirementDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateJobRequirementDto)
  requirements!: CreateJobRequirementDto[];

  @ApiProperty()
  @IsString()
  @Length(1, 240)
  rubricName!: string;

  @ApiProperty({ type: [CreateRubricCriterionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateRubricCriterionDto)
  rubricCriteria!: CreateRubricCriterionDto[];
}

export class UpdateJobDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 240)
  title?: string;

  @ApiPropertyOptional({ enum: ["draft", "open", "paused", "closed", "archived"] })
  @IsOptional()
  @IsIn(["draft", "open", "paused", "closed", "archived"])
  status?: "draft" | "open" | "paused" | "closed" | "archived";

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 160)
  department?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 240)
  location?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 80)
  seniority?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  summary?: string;
}

export class SaveRubricDraftDto {
  @ApiProperty()
  @IsString()
  @Length(1, 240)
  name!: string;

  @ApiProperty({ type: [CreateRubricCriterionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateRubricCriterionDto)
  criteria!: CreateRubricCriterionDto[];
}

export class MoveApplicationStageDto {
  @ApiProperty()
  @IsString()
  @Length(1, 80)
  stage!: string;

  @ApiProperty()
  @IsString()
  @Length(3, 2000)
  reason!: string;
}

export class CreateEvidenceDto {
  @ApiProperty()
  @IsString()
  @Length(1, 64)
  evidenceType!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 64)
  sourceType!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 512)
  sourceReference!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  excerpt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  occurredAt?: string;
}

export class CreateCriterionEvaluationDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  criterionId!: string;

  @ApiProperty({ minimum: 0, maximum: 100 })
  @IsNumber()
  @Min(0)
  @Max(100)
  score!: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number;

  @ApiProperty()
  @IsString()
  @Length(3, 4000)
  rationale!: string;

  @ApiProperty({ type: [String], format: "uuid" })
  @IsArray()
  @IsUUID(undefined, { each: true })
  evidenceIds!: string[];

  @ApiPropertyOptional({ enum: ["pending", "reviewed", "approved"] })
  @IsOptional()
  @IsIn(["pending", "reviewed", "approved"])
  reviewState?: "pending" | "reviewed" | "approved";
}

export class UpsertShortlistEntryDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  applicationId!: string;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  rank?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  rationale?: string;
}

export class UpsertShortlistDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 240)
  name?: string;

  @ApiPropertyOptional({ enum: ["draft", "review", "finalized", "archived"] })
  @IsOptional()
  @IsIn(["draft", "review", "finalized", "archived"])
  status?: "draft" | "review" | "finalized" | "archived";

  @ApiProperty({ type: [UpsertShortlistEntryDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpsertShortlistEntryDto)
  entries!: UpsertShortlistEntryDto[];
}

export class SubmitHiringDecisionDto {
  @ApiProperty({ enum: ["advance", "hold", "reject", "hire", "withdraw"] })
  @IsIn(["advance", "hold", "reject", "hire", "withdraw"])
  decision!: "advance" | "hold" | "reject" | "hire" | "withdraw";

  @ApiProperty()
  @IsString()
  @Length(3, 4000)
  reason!: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  scorecardId?: string;
}

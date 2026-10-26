import { Type } from "class-transformer";
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber,
  IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min,
  MinLength, ValidateNested,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class JobSkillRequirementInputDto {
  @ApiProperty({ example: "aspnet-core" })
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{0,159}$/)
  skillKey!: string;

  @ApiProperty({ example: "ASP.NET Core" })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  nameEn!: string;

  @ApiPropertyOptional({ example: "ای‌اس‌پی دات‌نت کور" })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  nameFa?: string;

  @ApiProperty({ enum: ["technical", "soft"] })
  @IsIn(["technical", "soft"])
  category!: "technical" | "soft";

  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  requiredLevel!: number;

  @ApiProperty({ minimum: 0.001, maximum: 100 })
  @IsNumber()
  @Min(0.001)
  @Max(100)
  weight!: number;

  @ApiProperty()
  @IsBoolean()
  required!: boolean;

  @ApiProperty({ minimum: 1, maximum: 20 })
  @IsInt()
  @Min(1)
  @Max(20)
  minimumEvidenceCount!: number;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  rubricCriterionId?: string;
}

export class SaveJobSkillRequirementsDto {
  @ApiProperty({ type: [JobSkillRequirementInputDto], maxItems: 50 })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => JobSkillRequirementInputDto)
  skills!: JobSkillRequirementInputDto[];
}

export class JobSkillRequirementDto extends JobSkillRequirementInputDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ minimum: 1 }) requirementVersion!: number;
}

export class ReviewResumeSkillClaimDto {
  @ApiProperty({ enum: ["confirmed", "rejected", "corrected"] })
  @IsIn(["confirmed", "rejected", "corrected"])
  reviewState!: "confirmed" | "rejected" | "corrected";

  @ApiProperty({ minimum: 0, description: "Optimistic concurrency version from claim workspace" })
  @IsInt()
  @Min(0)
  expectedVersion!: number;

  @ApiPropertyOptional({ description: "Existing canonical skill key, required only for corrected" })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{0,159}$/)
  correctedSkillKey?: string;

  @ApiProperty({ minLength: 8, maxLength: 1000 })
  @IsString()
  @MinLength(8)
  @MaxLength(1000)
  reviewReason!: string;
}

export class ReviewedResumeSkillClaimDto {
  @ApiProperty({ format: "uuid" }) claimId!: string;
  @ApiProperty({ enum: ["confirmed", "rejected", "corrected"] }) reviewState!: "confirmed" | "rejected" | "corrected";
  @ApiProperty() skillKey!: string;
  @ApiProperty({ minimum: 1 }) reviewVersion!: number;
  @ApiProperty() reviewReason!: string;
  @ApiProperty({ format: "uuid" }) reviewerUserId!: string;
  @ApiProperty() reviewedAt!: string;
}

/** Immutable reviewer action log; source resume evidence remains unchanged. */
export class ResumeSkillClaimReviewEventDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ minimum: 1 }) reviewVersion!: number;
  @ApiProperty() previousState!: string;
  @ApiProperty({ enum: ["confirmed", "rejected", "corrected"] }) reviewState!: string;
  @ApiPropertyOptional() previousSkillKey?: string;
  @ApiPropertyOptional() skillKey?: string;
  @ApiProperty() reviewReason!: string;
  @ApiProperty({ format: "uuid" }) reviewerUserId!: string;
  @ApiProperty() createdAt!: string;
}

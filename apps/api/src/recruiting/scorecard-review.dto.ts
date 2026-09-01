import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsNumber, IsOptional, IsString, Length, Max, Min } from "class-validator";

export class ReviewScorecardDto {
  @ApiProperty({ enum: ["approved", "overridden", "needs_more_evidence"] })
  @IsIn(["approved", "overridden", "needs_more_evidence"])
  reviewState!: "approved" | "overridden" | "needs_more_evidence";

  @ApiPropertyOptional({ enum: ["strong_hire", "hire", "hold", "no_hire", "insufficient_evidence"] })
  @IsOptional()
  @IsIn(["strong_hire", "hire", "hold", "no_hire", "insufficient_evidence"])
  humanRecommendation?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  humanOverallScore?: number;

  @ApiProperty()
  @IsString()
  @Length(3, 4000)
  reason!: string;
}

export class ScorecardReviewDto {
  @ApiProperty() id!: string;
  @ApiProperty() scorecardId!: string;
  @ApiProperty() applicationId!: string;
  @ApiProperty() reviewerUserId!: string;
  @ApiProperty() reviewState!: string;
  @ApiPropertyOptional() humanRecommendation?: string;
  @ApiPropertyOptional() humanOverallScore?: number;
  @ApiProperty() reason!: string;
  @ApiProperty() aiHumanDisagreement!: boolean;
  @ApiPropertyOptional() algorithmRecommendation?: string;
  @ApiPropertyOptional() algorithmOverallScore?: number;
  @ApiProperty() createdAt!: string;
}

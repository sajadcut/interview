import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from "class-validator";

export class QueueAssessmentExecutionDto {
  @ApiPropertyOptional({ minimum: 1000, maximum: 600000 })
  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(600000)
  timeLimitMs?: number;

  @ApiPropertyOptional({ minimum: 64, maximum: 4096 })
  @IsOptional()
  @IsInt()
  @Min(64)
  @Max(4096)
  memoryLimitMb?: number;
}

export class ReviewAssessmentDto {
  @ApiProperty({ enum: ["approved", "needs_follow_up", "overridden"] })
  @IsIn(["approved", "needs_follow_up", "overridden"])
  reviewState!: "approved" | "needs_follow_up" | "overridden";

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @Min(0)
  @Max(100)
  reviewerScore?: number;

  @ApiProperty()
  @IsString()
  @Length(3, 4000)
  rationale!: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  criterionId?: string;
}

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

export class CandidateAssessmentSessionDto {
  @ApiProperty({ format: "uuid" }) session_id!: string;
  @ApiProperty() status!: string;
  @ApiPropertyOptional({ format: "date-time", nullable: true }) started_at?: string | null;
  @ApiPropertyOptional({ format: "date-time", nullable: true }) submitted_at?: string | null;
  @ApiPropertyOptional({ format: "date-time", nullable: true }) expires_at?: string | null;
  @ApiPropertyOptional({ nullable: true }) candidate_notice_version?: string | null;
  @ApiPropertyOptional({ nullable: true }) review_state?: string | null;
  @ApiProperty({ format: "uuid" }) assessment_id!: string;
  @ApiProperty() assessment_type!: string;
  @ApiProperty() title!: string;
  @ApiProperty() instructions!: string;
  @ApiPropertyOptional({ nullable: true }) time_limit_minutes?: number | null;
  @ApiProperty() version!: number;
  @ApiProperty() job_title!: string;
  @ApiPropertyOptional({ format: "uuid", nullable: true }) submission_id?: string | null;
  @ApiPropertyOptional({ format: "uuid", nullable: true }) result_id?: string | null;
  @ApiPropertyOptional({ nullable: true }) result_status?: string | null;
  @ApiPropertyOptional({ nullable: true }) normalized_score?: number | null;
}

export class CandidateAssessmentListDto {
  @ApiProperty({ format: "uuid" }) candidateId!: string;
  @ApiProperty({ format: "uuid" }) applicationId!: string;
  @ApiProperty({ type: [CandidateAssessmentSessionDto] }) sessions!: CandidateAssessmentSessionDto[];
  @ApiProperty() integrityNotice!: string;
}

export class CandidateAssessmentStartDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() status!: string;
  @ApiPropertyOptional({ format: "date-time", nullable: true }) started_at?: string | null;
  @ApiPropertyOptional({ format: "date-time", nullable: true }) expires_at?: string | null;
  @ApiPropertyOptional({ nullable: true }) candidate_notice_version?: string | null;
}

export class CandidateAssessmentSubmissionDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) assessment_session_id!: string;
  @ApiProperty() language!: string;
  @ApiProperty({ format: "date-time" }) submitted_at!: string;
  @ApiProperty() executionBoundary!: string;
  @ApiProperty() coreApiExecutedCode!: boolean;
}

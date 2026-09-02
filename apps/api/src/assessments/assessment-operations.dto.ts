import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from "class-validator";

export class QueueAssessmentExecutionDto {
  @ApiPropertyOptional({ type: Number, minimum: 1000, maximum: 600000 })
  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(600000)
  timeLimitMs?: number;

  @ApiPropertyOptional({ type: Number, minimum: 64, maximum: 4096 })
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

  @ApiPropertyOptional({ type: Number, minimum: 0, maximum: 100 })
  @IsOptional()
  @Min(0)
  @Max(100)
  reviewerScore?: number;

  @ApiProperty({ type: String })
  @IsString()
  @Length(3, 4000)
  rationale!: string;

  @ApiPropertyOptional({ type: String, format: "uuid" })
  @IsOptional()
  @IsUUID()
  criterionId?: string;
}

export class CandidateAssessmentSessionDto {
  @ApiProperty({ type: String, format: "uuid" }) session_id!: string;
  @ApiProperty({ type: String }) status!: string;
  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true }) started_at?: string | null;
  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true }) submitted_at?: string | null;
  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true }) expires_at?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) candidate_notice_version?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) review_state?: string | null;
  @ApiProperty({ type: String, format: "uuid" }) assessment_id!: string;
  @ApiProperty({ type: String }) assessment_type!: string;
  @ApiProperty({ type: String }) title!: string;
  @ApiProperty({ type: String }) instructions!: string;
  @ApiPropertyOptional({ type: Number, nullable: true }) time_limit_minutes?: number | null;
  @ApiProperty({ type: Number }) version!: number;
  @ApiProperty({ type: String }) job_title!: string;
  @ApiPropertyOptional({ type: String, format: "uuid", nullable: true }) submission_id?: string | null;
  @ApiPropertyOptional({ type: String, format: "uuid", nullable: true }) result_id?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) result_status?: string | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) normalized_score?: number | null;
}

export class CandidateAssessmentListDto {
  @ApiProperty({ type: String, format: "uuid" }) candidateId!: string;
  @ApiProperty({ type: String, format: "uuid" }) applicationId!: string;
  @ApiProperty({ type: [CandidateAssessmentSessionDto] }) sessions!: CandidateAssessmentSessionDto[];
  @ApiProperty({ type: String }) integrityNotice!: string;
}

export class CandidateAssessmentStartDto {
  @ApiProperty({ type: String, format: "uuid" }) id!: string;
  @ApiProperty({ type: String }) status!: string;
  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true }) started_at?: string | null;
  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true }) expires_at?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) candidate_notice_version?: string | null;
}

export class CandidateAssessmentSubmissionDto {
  @ApiProperty({ type: String, format: "uuid" }) id!: string;
  @ApiProperty({ type: String, format: "uuid" }) assessment_session_id!: string;
  @ApiProperty({ type: String }) language!: string;
  @ApiProperty({ type: String, format: "date-time" }) submitted_at!: string;
  @ApiProperty({ type: String }) executionBoundary!: string;
  @ApiProperty({ type: Boolean }) coreApiExecutedCode!: boolean;
}

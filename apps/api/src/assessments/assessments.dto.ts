import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class AssessmentSessionRequestDto {
  @ApiProperty() applicationId!: string;
  @ApiPropertyOptional() candidateNoticeVersion?: string;
}

export class AssessmentSubmissionRequestDto {
  @ApiProperty() language!: string;
  @ApiPropertyOptional() sourceText?: string;
  @ApiPropertyOptional() artifactFileId?: string;
}

export class AssessmentSubmissionDto {
  @ApiProperty() id!: string;
  @ApiProperty() assessmentSessionId!: string;
  @ApiPropertyOptional() language?: string;
  @ApiProperty() submittedAt!: string;
  @ApiProperty({ description: "Core API never executes candidate code." })
  executionBoundary!: string;
}

export class AssessmentResultInputDto {
  @ApiProperty() runnerType!: string;
  @ApiProperty() runnerVersion!: string;
  @ApiProperty({ enum: ["passed", "failed", "runtime_error", "timeout", "runner_error"] })
  status!: string;
  @ApiProperty({ minimum: 0 }) passedTests!: number;
  @ApiProperty({ minimum: 1 }) totalTests!: number;
  @ApiPropertyOptional() rawScore?: number;
  @ApiProperty({ type: Object }) details!: Record<string, unknown>;
}

export class AssessmentResultDto {
  @ApiProperty() id!: string;
  @ApiProperty() submissionId!: string;
  @ApiProperty() status!: string;
  @ApiProperty() passedTests!: number;
  @ApiProperty() totalTests!: number;
  @ApiProperty() normalizedScore!: number;
  @ApiProperty() runnerType!: string;
  @ApiProperty() runnerVersion!: string;
  @ApiProperty({ type: Object }) details!: Record<string, unknown>;
  @ApiProperty() createdAt!: string;
}

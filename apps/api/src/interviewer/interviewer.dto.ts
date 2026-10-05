import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsISO8601, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from "class-validator";
import { CandidateInvitationResponseDto } from "../auth/dto/candidate-auth.dto";

export class AssignInterviewerDto {
  @ApiProperty() @IsUUID() sessionId!: string;
  @ApiProperty() @IsUUID() interviewerUserId!: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() scheduledFor?: string;
}

export class ScheduleTechnicalInterviewDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  applicationId!: string;

  @ApiProperty({ format: "uuid" })
  @IsUUID()
  interviewerUserId!: string;

  @ApiProperty({ format: "date-time" })
  @IsISO8601()
  scheduledFor!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  language?: string;

  @ApiPropertyOptional({ minimum: 15, maximum: 180, default: 60 })
  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(180)
  durationMinutes?: number;
}

export class ScheduledTechnicalInterviewDto {
  @ApiProperty({ format: "uuid" }) sessionId!: string;
  @ApiProperty({ format: "uuid" }) applicationId!: string;
  @ApiProperty({ format: "uuid" }) interviewerUserId!: string;
  @ApiProperty({ format: "date-time" }) scheduledFor!: string;
  @ApiProperty() durationMinutes!: number;
  @ApiProperty() pipelineStage!: string;
}

export class PrepareAiInterviewDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  applicationId!: string;

  @ApiPropertyOptional({ default: "fa" })
  @IsOptional()
  @IsString()
  language?: string;
}

export class PreparedAiInterviewDto {
  @ApiProperty({ format: "uuid" }) applicationId!: string;
  @ApiProperty({ format: "uuid" }) interviewPlanId!: string;
  @ApiProperty() pipelineStage!: string;
  @ApiProperty({ type: CandidateInvitationResponseDto })
  invitation!: CandidateInvitationResponseDto;
}

export class InterviewerNoteInputDto {
  @ApiProperty({ minLength: 1, maxLength: 10000 })
  @IsString()
  @Length(1, 10000)
  body!: string;
}

export class SubmitInterviewerEvaluationDto {
  @ApiProperty({ type: [Object] })
  @IsArray()
  criterionResults!: Record<string, unknown>[];

  @ApiPropertyOptional({ enum: ["strong_yes", "yes", "mixed", "no", "strong_no"] })
  @IsOptional()
  @IsIn(["strong_yes", "yes", "mixed", "no", "strong_no"])
  recommendation?: string;
}

// Interview operations may return applications that reached the interview stage before a Session exists.
// Interviewer mode is included so AI selections survive recovery and prefill the operations UI.
// Contract sync final marker for interviewer-mode recovery.
export class InterviewAssignmentSessionOptionDto {
  @ApiPropertyOptional({
    format: "uuid",
    description: "Absent when an application is in the interview stage but still needs a real interview session to be scheduled.",
  })
  sessionId?: string;

  @ApiProperty() sessionStatus!: string;
  @ApiProperty({ format: "uuid" }) applicationId!: string;
  @ApiProperty() candidateName!: string;
  @ApiProperty() jobTitle!: string;
  @ApiPropertyOptional({ enum: ["ai", "human"] }) interviewerMode?: "ai" | "human";
  @ApiPropertyOptional({ format: "uuid" }) interviewerUserId?: string;
  @ApiPropertyOptional() interviewerName?: string;
  @ApiPropertyOptional({ format: "email" }) interviewerEmail?: string;
  @ApiPropertyOptional() assignmentStatus?: string;
  @ApiPropertyOptional({ format: "date-time" }) scheduledFor?: string;
}

export class InterviewerOptionDto {
  @ApiProperty({ format: "uuid" }) profileId!: string;
  @ApiProperty({ format: "uuid" }) userId!: string;
  @ApiProperty({ format: "email" }) email!: string;
  @ApiPropertyOptional() displayName?: string;
  @ApiProperty({ type: [String] }) specialties!: string[];
}

export class InterviewAssignmentOptionsDto {
  @ApiProperty({ type: [InterviewAssignmentSessionOptionDto] })
  sessions!: InterviewAssignmentSessionOptionDto[];

  @ApiProperty({ type: [InterviewerOptionDto] })
  interviewers!: InterviewerOptionDto[];
}

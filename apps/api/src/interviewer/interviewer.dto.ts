import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsISO8601, IsIn, IsOptional, IsString, IsUUID, Length } from "class-validator";

export class AssignInterviewerDto {
  @ApiProperty() @IsUUID() sessionId!: string;
  @ApiProperty() @IsUUID() interviewerUserId!: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() scheduledFor?: string;
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

export class InterviewAssignmentSessionOptionDto {
  @ApiProperty({ format: "uuid" }) sessionId!: string;
  @ApiProperty() sessionStatus!: string;
  @ApiProperty({ format: "uuid" }) applicationId!: string;
  @ApiProperty() candidateName!: string;
  @ApiProperty() jobTitle!: string;
  @ApiPropertyOptional({ format: "uuid" }) interviewerUserId?: string;
  @ApiPropertyOptional() interviewerName?: string;
  @ApiPropertyOptional({ format: "email" }) interviewerEmail?: string;
  @ApiPropertyOptional() assignmentStatus?: string;
  @ApiPropertyOptional({ format: "date-time" }) scheduledFor?: string;
}

export class InterviewerOptionDto {
  @ApiProperty({ format: "uuid" }) userId!: string;
  @ApiProperty({ format: "email" }) email!: string;
  @ApiPropertyOptional() displayName?: string;
}

export class InterviewAssignmentOptionsDto {
  @ApiProperty({ type: [InterviewAssignmentSessionOptionDto] })
  sessions!: InterviewAssignmentSessionOptionDto[];

  @ApiProperty({ type: [InterviewerOptionDto] })
  interviewers!: InterviewerOptionDto[];
}

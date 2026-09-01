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

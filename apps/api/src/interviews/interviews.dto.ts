import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class CreateInterviewSessionDto {
  @ApiProperty() applicationId!: string;
  @ApiProperty() interviewPlanId!: string;
  @ApiProperty() consentRecordId!: string;
  @ApiProperty({ default: false }) candidateIsRealCustomerCandidate!: boolean;
  @ApiProperty({ default: false }) synchronousHumanSupervisorPresent!: boolean;
}

export class InterviewSessionStartDto {
  @ApiProperty() id!: string;
  @ApiProperty() status!: string;
  @ApiProperty() lifecycleStage!: string;
  @ApiProperty() releaseMode!: string;
  @ApiProperty() planVersion!: number;
  @ApiProperty() remainingSeconds!: number;
}

export class AppendInterviewTurnDto {
  @ApiProperty({ enum: ["ask", "probe", "clarify", "transition", "close", "escalate"] })
  action!: "ask" | "probe" | "clarify" | "transition" | "close" | "escalate";
  @ApiPropertyOptional() criterion?: string | null;
  @ApiProperty() objective!: string;
  @ApiProperty() spokenText!: string;
  @ApiProperty({ type: [String] }) expectedEvidence!: string[];
  @ApiPropertyOptional({
    enum: [
      "ANSWER",
      "CLARIFICATION_REQUEST",
      "SKIP_REQUEST",
      "INTERRUPTION",
      "SILENCE_TIMEOUT",
      "RECONNECT",
      "CANDIDATE_QUESTION",
      "POLICY_REFUSAL",
    ],
  })
  candidateIntent?: string;
}

export class InterviewTurnDto extends AppendInterviewTurnDto {
  @ApiProperty() id!: string;
  @ApiProperty() sequence!: number;
  @ApiProperty() finalized!: boolean;
  @ApiProperty() createdAt!: string;
}

export class TranscriptSegmentInputDto {
  @ApiProperty({ enum: ["candidate", "interviewer", "system"] }) speaker!: string;
  @ApiProperty({ minimum: 0 }) startMs!: number;
  @ApiProperty({ minimum: 0 }) endMs!: number;
  @ApiProperty() text!: string;
  @ApiProperty({ default: true }) isFinal!: boolean;
  @ApiPropertyOptional({ minimum: 0, maximum: 1 }) sttConfidence?: number;
}

export class TranscriptSegmentDto extends TranscriptSegmentInputDto {
  @ApiProperty() id!: string;
  @ApiProperty() createdAt!: string;
}

export class InterviewEvidenceInputDto {
  @ApiPropertyOptional() criterionId?: string;
  @ApiPropertyOptional() turnId?: string;
  @ApiProperty({ type: [String] }) transcriptSegmentIds!: string[];
  @ApiProperty() summary!: string;
  @ApiPropertyOptional({ minimum: 0, maximum: 1 }) confidence?: number;
}

export class InterviewEvidenceDto extends InterviewEvidenceInputDto {
  @ApiProperty() id!: string;
  @ApiProperty() createdAt!: string;
}

import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

const candidateIntentValues = [
  "ANSWER",
  "CLARIFICATION_REQUEST",
  "SKIP_REQUEST",
  "INTERRUPTION",
  "SILENCE_TIMEOUT",
  "RECONNECT",
  "CANDIDATE_QUESTION",
  "POLICY_REFUSAL",
] as const;

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
  @ApiPropertyOptional({ enum: candidateIntentValues })
  candidateIntent?: string;
}

export class InterviewTurnDto extends AppendInterviewTurnDto {
  @ApiProperty() id!: string;
  @ApiProperty() sequence!: number;
  @ApiProperty() finalized!: boolean;
  @ApiProperty() createdAt!: string;
}

export class InterviewBrainNextTurnInputDto {
  @ApiPropertyOptional({ description: "Latest finalized candidate transcript text for state/context only." })
  latestCandidateText?: string;

  @ApiPropertyOptional({ enum: candidateIntentValues })
  candidateIntent?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 600, default: 0 })
  elapsedSeconds?: number;
}

export class InterviewBrainTurnDto extends InterviewTurnDto {
  @ApiProperty() questionId!: string;
  @ApiProperty() brainVersion!: string;
  @ApiProperty() brainReason!: string;
  @ApiProperty() remainingSeconds!: number;
  @ApiProperty({ type: Object, additionalProperties: { type: "number" } })
  evidenceCoverage!: Record<string, number>;
  @ApiProperty() releaseMode!: string;
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

import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from "class-validator";

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

const interviewActionValues = ["ask", "probe", "clarify", "transition", "close", "escalate"] as const;
const transcriptSpeakerValues = ["candidate", "interviewer", "system"] as const;

export class CreateInterviewSessionDto {
  @ApiProperty()
  @IsUUID()
  applicationId!: string;

  @ApiProperty()
  @IsUUID()
  interviewPlanId!: string;

  @ApiProperty()
  @IsUUID()
  consentRecordId!: string;

  @ApiProperty({ default: false })
  @IsBoolean()
  candidateIsRealCustomerCandidate!: boolean;

  @ApiProperty({ default: false })
  @IsBoolean()
  synchronousHumanSupervisorPresent!: boolean;
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
  @ApiProperty({ enum: interviewActionValues })
  @IsIn(interviewActionValues)
  action!: "ask" | "probe" | "clarify" | "transition" | "close" | "escalate";

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  criterion?: string | null;

  @ApiProperty()
  @IsString()
  objective!: string;

  @ApiProperty()
  @IsString()
  spokenText!: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  expectedEvidence!: string[];

  @ApiPropertyOptional({ enum: candidateIntentValues })
  @IsOptional()
  @IsIn(candidateIntentValues)
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
  @IsOptional()
  @IsString()
  latestCandidateText?: string;

  @ApiPropertyOptional({ enum: candidateIntentValues })
  @IsOptional()
  @IsIn(candidateIntentValues)
  candidateIntent?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 600, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(600)
  elapsedSeconds?: number;
}

export class InterviewBrainTurnDto extends InterviewTurnDto {
  @ApiProperty() questionId!: string;
  @ApiProperty() brainVersion!: string;
  @ApiProperty() brainReason!: string;
  @ApiProperty() remainingSeconds!: number;
  @ApiProperty({ type: Object })
  evidenceCoverage!: Record<string, number>;
  @ApiProperty() releaseMode!: string;
}

export class TranscriptSegmentInputDto {
  @ApiProperty({ enum: transcriptSpeakerValues })
  @IsIn(transcriptSpeakerValues)
  speaker!: string;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  startMs!: number;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  endMs!: number;

  @ApiProperty()
  @IsString()
  text!: string;

  @ApiProperty({ default: true })
  @IsBoolean()
  isFinal!: boolean;

  @ApiPropertyOptional({ minimum: 0, maximum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  sttConfidence?: number;
}

export class TranscriptSegmentDto extends TranscriptSegmentInputDto {
  @ApiProperty() id!: string;
  @ApiProperty() createdAt!: string;
}

export class InterviewEvidenceInputDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  criterionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  turnId?: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsUUID(undefined, { each: true })
  transcriptSegmentIds!: string[];

  @ApiProperty()
  @IsString()
  summary!: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number;
}

export class InterviewEvidenceDto extends InterviewEvidenceInputDto {
  @ApiProperty() id!: string;
  @ApiProperty() createdAt!: string;
}

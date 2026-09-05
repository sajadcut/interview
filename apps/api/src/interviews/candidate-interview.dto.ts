import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength, MinLength } from "class-validator";

export class CandidateInterviewStartDto {
  @IsOptional()
  @IsBoolean()
  developmentPreview?: boolean;
}

export class CandidateInterviewTextAnswerDto {
  @IsUUID()
  sessionId!: string;

  @IsUUID()
  mediaSessionId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(12_000)
  text!: string;
}

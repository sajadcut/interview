import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsObject, IsOptional, IsString, Length } from "class-validator";
import { MediaComponents, RealtimeMediaModes } from "./interview-media.contracts";

export const InterviewMediaEventTypes = [
  "preflight",
  "provider_status",
  "connecting",
  "connected",
  "degraded",
  "disconnected",
  "reconnected",
  "participant_joined",
  "participant_left",
  "turn_failure",
  "vad_speech_start",
  "vad_speech_end",
  "stt_final",
  "brain_turn",
  "tts_started",
  "tts_ended",
  "avatar_started",
  "avatar_ended",
  "heartbeat",
  "ended",
  "error",
] as const;

export type InterviewMediaEventType = (typeof InterviewMediaEventTypes)[number];

export const InterviewMediaEventSources = [
  "transport",
  "vad",
  "stt",
  "brain",
  "tts",
  "avatar",
  "api",
] as const;

export type InterviewMediaEventSource = (typeof InterviewMediaEventSources)[number];

export class InterviewMediaModeDto {
  @ApiProperty({ enum: RealtimeMediaModes })
  @IsIn(RealtimeMediaModes)
  mode!: "audio" | "avatar";
}

export class InterviewMediaReadinessQueryDto {
  @ApiPropertyOptional({ enum: RealtimeMediaModes, default: "audio" })
  @IsOptional()
  @IsIn(RealtimeMediaModes)
  mode?: "audio" | "avatar";
}

export class MediaProviderStatusDto {
  @ApiProperty({ enum: MediaComponents })
  component!: "transport" | "vad" | "stt" | "tts" | "avatar";

  @ApiProperty() provider!: string;
  @ApiProperty() configured!: boolean;
  @ApiProperty() reachable!: boolean;
  @ApiProperty() ready!: boolean;
  @ApiPropertyOptional() version?: string;
  @ApiPropertyOptional() reason?: string;
  @ApiPropertyOptional({ format: "date-time" }) checkedAt?: string;
}

export class MediaPrivacyPolicyDto {
  @ApiProperty({ enum: ["none"] }) candidateVideoAnalysis!: "none";
  @ApiProperty({ enum: [false] }) biometricInferenceAllowed!: false;
  @ApiProperty({ enum: [false] }) rawMediaPersistedByApi!: false;
  @ApiProperty({ enum: [true] }) spokenTextOnlyToAvatar!: true;
}

export class InterviewMediaReadinessDto {
  @ApiProperty() enabled!: boolean;
  @ApiProperty({ enum: RealtimeMediaModes }) mode!: "audio" | "avatar";
  @ApiProperty() ready!: boolean;
  @ApiProperty({ type: [String] }) blockers!: string[];
  @ApiProperty({ type: [MediaProviderStatusDto] }) providers!: MediaProviderStatusDto[];
  @ApiProperty({ enum: MediaComponents, isArray: true }) requiredComponents!: Array<"transport" | "vad" | "stt" | "tts" | "avatar">;
  @ApiProperty({ type: MediaPrivacyPolicyDto }) privacy!: MediaPrivacyPolicyDto;
}

export class InterviewMediaEventInputDto {
  @ApiProperty({
    minLength: 8,
    maxLength: 200,
    description: "Stable caller-generated key. Retrying the same event with this key returns the original journal entry.",
  })
  @IsString()
  @Length(8, 200)
  idempotencyKey!: string;

  @ApiProperty({ enum: InterviewMediaEventTypes })
  @IsIn(InterviewMediaEventTypes)
  eventType!: InterviewMediaEventType;

  @ApiPropertyOptional({ enum: InterviewMediaEventSources })
  @IsOptional()
  @IsIn(InterviewMediaEventSources)
  sourceComponent?: InterviewMediaEventSource;

  @ApiPropertyOptional({
    type: Object,
    description: "Operational metadata only. Raw media, transcript text and credentials are rejected.",
  })
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}

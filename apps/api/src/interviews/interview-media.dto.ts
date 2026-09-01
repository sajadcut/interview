import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsObject, IsOptional, IsString, Length } from "class-validator";
import { RealtimeMediaModes } from "./interview-media.contracts";

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

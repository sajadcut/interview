import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsObject, IsOptional } from "class-validator";
import { RealtimeMediaModes } from "./interview-media.contracts";

export const InterviewMediaEventTypes = [
  "preflight",
  "provider_status",
  "connecting",
  "connected",
  "degraded",
  "disconnected",
  "reconnected",
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
  @ApiProperty({ enum: InterviewMediaEventTypes })
  @IsIn(InterviewMediaEventTypes)
  eventType!: InterviewMediaEventType;

  @ApiPropertyOptional({ enum: InterviewMediaEventSources })
  @IsOptional()
  @IsIn(InterviewMediaEventSources)
  sourceComponent?: InterviewMediaEventSource;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}

import type { IncomingMessage } from "node:http";
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  PayloadTooLargeException,
  Post,
  Query,
  Req,
  StreamableFile,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { ApiConsumes, ApiExcludeEndpoint, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { AuditedAction } from "../audit/audited-action.decorator";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { ApiStandardErrorResponses } from "../common/http/api-standard-error-responses.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import {
  InterviewMediaEventInputDto,
  InterviewMediaModeDto,
  InterviewMediaReadinessDto,
  InterviewMediaReadinessQueryDto,
} from "./interview-media.dto";
import { InterviewMediaEventService } from "./interview-media-event.service";
import { InterviewMediaService } from "./interview-media.service";
import { InterviewSpeechService } from "./interview-speech.service";
import type { SpeechToTextContentType } from "./speech-to-text.adapter";

const MAX_CANDIDATE_AUDIO_BYTES = 20 * 1024 * 1024;

async function readRawAudio(request: IncomingMessage): Promise<Buffer> {
  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_CANDIDATE_AUDIO_BYTES) {
    throw new PayloadTooLargeException("Candidate audio exceeds the 20 MB development bridge limit");
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const value of request) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    total += chunk.length;
    if (total > MAX_CANDIDATE_AUDIO_BYTES) {
      throw new PayloadTooLargeException("Candidate audio exceeds the 20 MB development bridge limit");
    }
    chunks.push(chunk);
  }
  if (total === 0) throw new BadRequestException("Candidate audio body is required");
  return Buffer.concat(chunks, total);
}

function candidateAudioContentType(request: IncomingMessage): SpeechToTextContentType {
  const value = String(request.headers["content-type"] ?? "")
    .split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (value !== "audio/wav" && value !== "audio/x-wav") {
    throw new UnsupportedMediaTypeException("Candidate audio must be PCM WAV");
  }
  return value;
}

@ApiTags("interview-media")
@Controller("v1/interviews")
@RequireTenant()
export class InterviewMediaController {
  constructor(
    private readonly media: InterviewMediaService,
    private readonly mediaEvents: InterviewMediaEventService,
    private readonly speech: InterviewSpeechService,
  ) {}

  @Get("media/readiness")
  @RequirePermissions(Permissions.InterviewManage)
  @ApiOkResponse({ type: InterviewMediaReadinessDto, description: "Provider-neutral realtime media readiness. No credentials are returned." })
  @ApiStandardErrorResponses()
  getReadiness(@Query() query: InterviewMediaReadinessQueryDto) {
    return this.media.getReadiness(query.mode ?? "audio");
  }

  @Post(":sessionId/media/preflight")
  @RequirePermissions(Permissions.InterviewManage)
  @AuditedAction("interview.media.preflight", "interview_session")
  @ApiOkResponse({ description: "Consent, release and provider readiness for a realtime media session." })
  preflight(@Param("sessionId") sessionId: string, @Body() body: InterviewMediaModeDto) {
    return this.media.preflight(sessionId, body.mode);
  }

  @Post(":sessionId/media/sessions")
  @RequirePermissions(Permissions.InterviewManage)
  @AuditedAction("interview.media.session.create", "interview_media_session")
  @ApiOkResponse({ description: "Persist a media lifecycle session after a successful preflight." })
  createMediaSession(@Param("sessionId") sessionId: string, @Body() body: InterviewMediaModeDto) {
    return this.media.createMediaSession(sessionId, body.mode);
  }

  @Post(":sessionId/media/sessions/:mediaSessionId/connection")
  @RequirePermissions(Permissions.InterviewManage)
  @AuditedAction("interview.media.connection.issue", "interview_media_session")
  @ApiOkResponse({ description: "Issue a short-lived room-scoped LiveKit token for a synthetic/internal candidate. Token is never persisted." })
  issueConnection(
    @Param("sessionId") sessionId: string,
    @Param("mediaSessionId") mediaSessionId: string,
  ) {
    return this.media.issueConnection(sessionId, mediaSessionId);
  }

  @Post(":sessionId/media/sessions/:mediaSessionId/candidate-audio")
  @ApiExcludeEndpoint()
  @ApiConsumes("audio/wav", "audio/x-wav")
  @RequirePermissions(Permissions.InterviewManage)
  @AuditedAction("interview.media.candidate_audio.transcribe", "interview_media_session")
  async transcribeCandidateAudio(
    @Param("sessionId") sessionId: string,
    @Param("mediaSessionId") mediaSessionId: string,
    @Req() request: IncomingMessage,
  ) {
    const contentType = candidateAudioContentType(request);
    const audio = await readRawAudio(request);
    return this.speech.transcribeCandidateAudio(sessionId, mediaSessionId, audio, contentType);
  }

  @Post(":sessionId/media/sessions/:mediaSessionId/turns/:turnId/audio")
  @RequirePermissions(Permissions.InterviewManage)
  @AuditedAction("interview.media.tts.synthesize", "interview_media_session")
  @ApiOkResponse({ description: "Stream WAV synthesized only from the persisted finalized Interview Brain spoken_text. No client-supplied text is accepted." })
  async synthesizePersistedTurn(
    @Param("sessionId") sessionId: string,
    @Param("mediaSessionId") mediaSessionId: string,
    @Param("turnId") turnId: string,
  ) {
    const result = await this.speech.synthesizePersistedTurn(sessionId, mediaSessionId, turnId);
    return new StreamableFile(result.audio, {
      type: result.contentType,
      disposition: `inline; filename="interview-turn-${turnId}.wav"`,
      length: result.audio.length,
    });
  }

  @Get(":sessionId/media/sessions/latest")
  @RequirePermissions(Permissions.InterviewRead)
  @ApiOkResponse({ description: "Latest persisted media lifecycle state for the interview session." })
  getLatestMediaSession(@Param("sessionId") sessionId: string) {
    return this.media.getLatestMediaSession(sessionId);
  }

  @Get(":sessionId/media/sessions/:mediaSessionId/participants")
  @RequirePermissions(Permissions.InterviewRead)
  @ApiOkResponse({ description: "Provider-neutral participant lifecycle state without credentials or raw media." })
  listParticipants(
    @Param("sessionId") sessionId: string,
    @Param("mediaSessionId") mediaSessionId: string,
  ) {
    return this.mediaEvents.listParticipants(sessionId, mediaSessionId);
  }

  @Post(":sessionId/media/sessions/:mediaSessionId/events")
  @RequirePermissions(Permissions.InterviewManage)
  @AuditedAction("interview.media.event.append", "interview_media_session")
  @ApiOkResponse({ description: "Idempotently append an operational media event without raw media, transcript text or credentials." })
  appendEvent(
    @Param("sessionId") sessionId: string,
    @Param("mediaSessionId") mediaSessionId: string,
    @Body() body: InterviewMediaEventInputDto,
  ) {
    return this.mediaEvents.appendEvent(sessionId, mediaSessionId, body);
  }
}

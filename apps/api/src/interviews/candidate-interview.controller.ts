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
import { ApiExcludeController } from "@nestjs/swagger";
import type { Request } from "express";
import { CANDIDATE_SESSION_COOKIE } from "../auth/candidate-session.service";
import { readCookie } from "../auth/cookie";
import { CandidateInterviewStartDto, CandidateInterviewTextAnswerDto } from "./candidate-interview.dto";
import { CandidateInterviewService } from "./candidate-interview.service";
import type { SpeechToTextContentType } from "./speech-to-text.adapter";

const MAX_CANDIDATE_AUDIO_BYTES = 20 * 1024 * 1024;

function candidateToken(request: Request): string | undefined {
  return readCookie(request.header("cookie"), CANDIDATE_SESSION_COOKIE);
}

async function readRawAudio(request: IncomingMessage): Promise<Buffer> {
  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_CANDIDATE_AUDIO_BYTES) {
    throw new PayloadTooLargeException("Candidate audio exceeds the 20 MB limit");
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const value of request) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    total += chunk.length;
    if (total > MAX_CANDIDATE_AUDIO_BYTES) {
      throw new PayloadTooLargeException("Candidate audio exceeds the 20 MB limit");
    }
    chunks.push(chunk);
  }
  if (total === 0) throw new BadRequestException("Candidate audio body is required");
  return Buffer.concat(chunks, total);
}

function audioContentType(request: IncomingMessage): SpeechToTextContentType {
  const value = String(request.headers["content-type"] ?? "")
    .split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (value !== "audio/wav" && value !== "audio/x-wav") {
    throw new UnsupportedMediaTypeException("Candidate audio must be PCM WAV");
  }
  return value;
}

@ApiExcludeController()
@Controller("v1/candidate-interview")
export class CandidateInterviewController {
  constructor(private readonly candidateInterview: CandidateInterviewService) {}

  @Post("start")
  start(@Req() request: Request, @Body() body: CandidateInterviewStartDto) {
    return this.candidateInterview.start(candidateToken(request), body.developmentPreview === true);
  }

  @Post("answers/text")
  answerText(@Req() request: Request, @Body() body: CandidateInterviewTextAnswerDto) {
    return this.candidateInterview.answerText(candidateToken(request), body);
  }

  @Post("answers/audio")
  async answerAudio(
    @Req() request: Request,
    @Query("sessionId") sessionId: string,
    @Query("mediaSessionId") mediaSessionId: string,
  ) {
    if (!sessionId || !mediaSessionId) {
      throw new BadRequestException("sessionId and mediaSessionId are required");
    }
    const contentType = audioContentType(request);
    const audio = await readRawAudio(request);
    return this.candidateInterview.answerAudio(
      candidateToken(request),
      sessionId,
      mediaSessionId,
      audio,
      contentType,
    );
  }

  @Post("sessions/:sessionId/media/:mediaSessionId/turns/:turnId/audio")
  async turnAudio(
    @Req() request: Request,
    @Param("sessionId") sessionId: string,
    @Param("mediaSessionId") mediaSessionId: string,
    @Param("turnId") turnId: string,
  ) {
    const result = await this.candidateInterview.turnAudio(
      candidateToken(request),
      sessionId,
      mediaSessionId,
      turnId,
    );
    return new StreamableFile(result.audio, {
      type: result.contentType,
      disposition: `inline; filename="interview-turn-${turnId}.wav"`,
      length: result.audio.length,
    });
  }

  @Get("health")
  health() {
    return { service: "candidate-interview", ready: true };
  }
}

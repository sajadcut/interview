import { Body, Controller, Get, Post, Req } from "@nestjs/common";
import { ApiOkResponse, ApiTags, ApiUnauthorizedResponse } from "@nestjs/swagger";
import type { Request } from "express";
import { ApiErrorDto } from "../common/http/api-error.dto";
import { CandidateConsentService } from "./candidate-consent.service";
import { CANDIDATE_SESSION_COOKIE } from "./candidate-session.service";
import { readCookie } from "./cookie";
import {
  CandidateConsentReceiptDto,
  CandidateConsentStatusDto,
  RecordCandidateConsentDto,
} from "./dto/candidate-consent.dto";

@ApiTags("candidate-consent")
@Controller("v1/candidate-consent")
export class CandidateConsentController {
  constructor(private readonly consents: CandidateConsentService) {}

  @Get()
  @ApiOkResponse({ type: CandidateConsentStatusDto })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  status(@Req() request: Request) {
    return this.consents.status(readCookie(request.header("cookie"), CANDIDATE_SESSION_COOKIE));
  }

  @Post()
  @ApiOkResponse({ type: CandidateConsentReceiptDto })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  record(@Req() request: Request, @Body() body: RecordCandidateConsentDto) {
    return this.consents.record(
      readCookie(request.header("cookie"), CANDIDATE_SESSION_COOKIE),
      body,
    );
  }
}

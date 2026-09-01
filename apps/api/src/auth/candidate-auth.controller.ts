import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { Request, Response } from "express";
import { ApiErrorDto } from "../common/http/api-error.dto";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import { CandidateAuthService } from "./candidate-auth.service";
import {
  CANDIDATE_SESSION_COOKIE,
  type IssuedCandidateSession,
} from "./candidate-session.service";
import { readCookie } from "./cookie";
import {
  CandidateAuthenticationResponseDto,
  CandidateInvitationResponseDto,
  CandidateMagicLinkValidationDto,
  CandidateSessionDto,
  CreateCandidateInvitationDto,
  ValidateCandidateMagicLinkDto,
  VerifyCandidateOtpDto,
} from "./dto/candidate-auth.dto";
import { Permissions } from "./permissions";
import { RequirePermissions } from "./require-permissions.decorator";
import { SESSION_POLICY } from "./session-policy";

function setCandidateCookie(response: Response, issued: IssuedCandidateSession): void {
  response.cookie(CANDIDATE_SESSION_COOKIE, issued.sessionToken, {
    httpOnly: true,
    sameSite: SESSION_POLICY.cookie.sameSite,
    secure: SESSION_POLICY.cookie.secure,
    path: "/",
    maxAge: Math.max(0, issued.expiresAt.getTime() - Date.now()),
  });
}

function clearCandidateCookie(response: Response): void {
  response.clearCookie(CANDIDATE_SESSION_COOKIE, {
    httpOnly: true,
    sameSite: SESSION_POLICY.cookie.sameSite,
    secure: SESSION_POLICY.cookie.secure,
    path: "/",
  });
}

@ApiTags("candidate-auth")
@Controller("v1/candidate-auth")
export class CandidateAuthController {
  constructor(private readonly candidateAuth: CandidateAuthService) {}

  @Post("invitations")
  @RequireTenant()
  @RequirePermissions(Permissions.CandidateContact)
  @ApiOkResponse({ type: CandidateInvitationResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  createInvitation(@Body() body: CreateCandidateInvitationDto) {
    return this.candidateAuth.createInvitation(body);
  }

  @Post("magic-link/validate")
  @ApiOkResponse({ type: CandidateMagicLinkValidationDto })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  validateMagicLink(@Body() body: ValidateCandidateMagicLinkDto) {
    return this.candidateAuth.validateMagicLink(body.token);
  }

  @Post("otp/verify")
  @ApiOkResponse({ type: CandidateAuthenticationResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  async verifyOtp(
    @Body() body: VerifyCandidateOtpDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const issued = await this.candidateAuth.verifyOtp(body.token, body.otp);
    setCandidateCookie(response, issued);
    return {
      authenticated: true,
      sessionId: issued.sessionId,
      organizationId: issued.organizationId,
      candidateId: issued.candidateId,
      applicationId: issued.applicationId,
      expiresAt: issued.expiresAt.toISOString(),
    };
  }

  @Get("session")
  @ApiOkResponse({ type: CandidateSessionDto })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  session(@Req() request: Request) {
    return this.candidateAuth.getSession(
      readCookie(request.header("cookie"), CANDIDATE_SESSION_COOKIE),
    );
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: "Candidate session revoked and cookie cleared." })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.candidateAuth.logout(
      readCookie(request.header("cookie"), CANDIDATE_SESSION_COOKIE),
    );
    clearCandidateCookie(response);
  }
}

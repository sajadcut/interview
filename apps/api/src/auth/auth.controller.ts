import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import {
  ApiAcceptedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { Request, Response } from "express";
import { AuthContextService } from "./auth-context.service";
import { readCookie } from "./cookie";
import {
  LoginResponseDto,
  PasswordResetCompleteResponseDto,
  PasswordResetRequestResponseDto,
  RefreshResponseDto,
  SessionResponseDto,
} from "./dto/auth-response.dto";
import { LoginDto } from "./dto/login.dto";
import { RequestPasswordResetDto, ResetPasswordDto } from "./dto/password-recovery.dto";
import { EnterpriseAuthService } from "./enterprise-auth.service";
import { SensitiveRateLimit } from "./security/sensitive-rate-limit.decorator";
import { SESSION_POLICY } from "./session-policy";
import { SessionService, type IssuedSession, type SessionMetadata } from "./session.service";

function requestMetadata(request: Request): SessionMetadata {
  const metadata: SessionMetadata = {};
  if (request.ip) metadata.ip = request.ip;
  const userAgent = request.header("user-agent");
  if (userAgent) metadata.userAgent = userAgent;
  return metadata;
}

function setSessionCookies(response: Response, issued: IssuedSession): void {
  response.cookie(SESSION_POLICY.COOKIE_NAME, issued.sessionToken, {
    httpOnly: SESSION_POLICY.cookie.httpOnly,
    sameSite: SESSION_POLICY.cookie.sameSite,
    secure: SESSION_POLICY.cookie.secure,
    priority: SESSION_POLICY.cookie.priority,
    path: "/",
    maxAge: Math.max(0, issued.sessionExpiresAt.getTime() - Date.now()),
  });
  response.cookie(SESSION_POLICY.REFRESH_COOKIE_NAME, issued.refreshToken, {
    httpOnly: SESSION_POLICY.cookie.httpOnly,
    sameSite: SESSION_POLICY.cookie.sameSite,
    secure: SESSION_POLICY.cookie.secure,
    priority: SESSION_POLICY.cookie.priority,
    path: "/auth",
    maxAge: Math.max(0, issued.refreshExpiresAt.getTime() - Date.now()),
  });
}

function clearSessionCookies(response: Response): void {
  const base = {
    httpOnly: SESSION_POLICY.cookie.httpOnly,
    sameSite: SESSION_POLICY.cookie.sameSite,
    secure: SESSION_POLICY.cookie.secure,
  } as const;
  response.clearCookie(SESSION_POLICY.COOKIE_NAME, { ...base, path: "/" });
  response.clearCookie(SESSION_POLICY.REFRESH_COOKIE_NAME, { ...base, path: "/auth" });
}

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: EnterpriseAuthService,
    private readonly sessions: SessionService,
    private readonly authContext: AuthContextService,
  ) {}

  @Post("login")
  @SensitiveRateLimit("login")
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiUnauthorizedResponse({ description: "Invalid credentials, disabled account, or invalid session state." })
  async login(
    @Body() payload: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.login(payload.email, payload.password, requestMetadata(request));
    const organizations = await this.auth.listOrganizations(result.userId);
    setSessionCookies(response, result);
    return {
      user: {
        id: result.userId,
        email: result.email,
        displayName: result.displayName,
      },
      session: {
        id: result.sessionId,
        expiresAt: result.sessionExpiresAt.toISOString(),
      },
      organizations,
    };
  }

  @Post("password-reset/request")
  @SensitiveRateLimit("passwordResetRequest")
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiAcceptedResponse({ type: PasswordResetRequestResponseDto })
  requestPasswordReset(@Body() payload: RequestPasswordResetDto) {
    return this.auth.requestPasswordReset(payload.email);
  }

  @Post("password-reset/complete")
  @SensitiveRateLimit("passwordResetComplete")
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: PasswordResetCompleteResponseDto })
  resetPassword(@Body() payload: ResetPasswordDto) {
    return this.auth.resetPassword(payload.token, payload.password);
  }

  @Post("refresh")
  @SensitiveRateLimit("refresh")
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: RefreshResponseDto })
  @ApiUnauthorizedResponse({ description: "Refresh token is missing, expired, revoked, or already rotated." })
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const refreshToken = readCookie(
      request.header("cookie"),
      SESSION_POLICY.REFRESH_COOKIE_NAME,
    );
    if (!refreshToken) throw new UnauthorizedException("Refresh token is required");
    const issued = await this.sessions.rotateRefreshToken(refreshToken, requestMetadata(request));
    setSessionCookies(response, issued);
    return {
      session: {
        id: issued.sessionId,
        expiresAt: issued.sessionExpiresAt.toISOString(),
      },
    };
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: "Session and refresh token revoked." })
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const principal = this.authContext.getOptional();
    const cookieHeader = request.header("cookie");
    await this.sessions.revoke(
      readCookie(cookieHeader, SESSION_POLICY.COOKIE_NAME),
      readCookie(cookieHeader, SESSION_POLICY.REFRESH_COOKIE_NAME),
    );
    if (principal?.userId) {
      await this.auth.recordUserAudit(principal.userId, "auth.logout", {
        sessionId: principal.sessionId ?? null,
      });
    }
    clearSessionCookies(response);
  }

  @Get("session")
  @ApiOkResponse({ type: SessionResponseDto })
  @ApiUnauthorizedResponse({ description: "Authentication is required." })
  async session() {
    const principal = this.authContext.getOptional();
    if (!principal || principal.source !== "session") {
      throw new UnauthorizedException("Authentication is required");
    }
    return {
      userId: principal.userId,
      sessionId: principal.sessionId,
      organizations: await this.auth.listOrganizations(principal.userId),
    };
  }
}

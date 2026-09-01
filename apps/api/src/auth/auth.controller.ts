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
import type { Request, Response } from "express";
import { AuthContextService } from "./auth-context.service";
import { readCookie } from "./cookie";
import { LoginDto } from "./dto/login.dto";
import { EnterpriseAuthService } from "./enterprise-auth.service";
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
    path: "/",
    maxAge: Math.max(0, issued.sessionExpiresAt.getTime() - Date.now()),
  });
  response.cookie(SESSION_POLICY.REFRESH_COOKIE_NAME, issued.refreshToken, {
    httpOnly: SESSION_POLICY.cookie.httpOnly,
    sameSite: SESSION_POLICY.cookie.sameSite,
    secure: SESSION_POLICY.cookie.secure,
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

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: EnterpriseAuthService,
    private readonly sessions: SessionService,
    private readonly authContext: AuthContextService,
  ) {}

  @Post("login")
  @HttpCode(HttpStatus.OK)
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

  @Post("refresh")
  @HttpCode(HttpStatus.OK)
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
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const cookieHeader = request.header("cookie");
    await this.sessions.revoke(
      readCookie(cookieHeader, SESSION_POLICY.COOKIE_NAME),
      readCookie(cookieHeader, SESSION_POLICY.REFRESH_COOKIE_NAME),
    );
    clearSessionCookies(response);
  }

  @Get("session")
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

import { BadRequestException, Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { getEnv } from "../config/env";
import { AuthContextService } from "./auth-context.service";
import { readCookie } from "./cookie";
import { SESSION_POLICY } from "./session-policy";
import { SessionService } from "./session.service";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(
    private readonly authContext: AuthContextService,
    private readonly sessions: SessionService,
  ) {}

  async use(request: Request, _response: Response, next: NextFunction): Promise<void> {
    const sessionToken = readCookie(request.header("cookie"), SESSION_POLICY.COOKIE_NAME);
    if (sessionToken) {
      const principal = await this.sessions.resolveInternalSession(sessionToken);
      if (principal) {
        this.authContext.run(
          { userId: principal.userId, sessionId: principal.sessionId, source: "session" },
          next,
        );
        return;
      }
    }

    if (getEnv().NODE_ENV === "production") {
      this.authContext.run(undefined, next);
      return;
    }

    if (request.header("x-user-permissions")) {
      throw new BadRequestException(
        "x-user-permissions is not accepted; permissions are resolved from database roles",
      );
    }

    const userId = request.header("x-user-id")?.trim();
    if (!userId) {
      this.authContext.run(undefined, next);
      return;
    }
    if (!UUID_PATTERN.test(userId)) {
      throw new BadRequestException("x-user-id must be a UUID in development mode");
    }

    this.authContext.run({ userId, source: "development-header" }, next);
  }
}

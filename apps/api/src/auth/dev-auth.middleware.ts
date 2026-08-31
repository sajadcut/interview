import { BadRequestException, Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { AuthContextService } from "./auth-context.service";
import type { Permission } from "./permissions";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class DevAuthMiddleware implements NestMiddleware {
  constructor(private readonly authContext: AuthContextService) {}

  use(request: Request, _response: Response, next: NextFunction): void {
    if (process.env.NODE_ENV === "production") {
      this.authContext.run(undefined, next);
      return;
    }

    const userId = request.header("x-user-id")?.trim();
    if (!userId) {
      this.authContext.run(undefined, next);
      return;
    }
    if (!UUID_PATTERN.test(userId)) {
      throw new BadRequestException("x-user-id must be a UUID in development mode");
    }

    const permissions = new Set<Permission>(
      (request.header("x-user-permissions") ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean) as Permission[],
    );

    this.authContext.run({ userId, permissions }, next);
  }
}

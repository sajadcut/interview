import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { AuthContextService } from "./auth-context.service";
import type { Permission } from "./permissions";

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

    const permissions = new Set<Permission>(
      (request.header("x-user-permissions") ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean) as Permission[],
    );

    this.authContext.run({ userId, permissions }, next);
  }
}

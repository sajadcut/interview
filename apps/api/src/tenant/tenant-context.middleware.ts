import { BadRequestException, Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { TenantContextService } from "./tenant-context.service";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  constructor(private readonly tenantContext: TenantContextService) {}

  use(request: Request, _response: Response, next: NextFunction): void {
    const organizationId = request.header("x-organization-id")?.trim();
    if (organizationId && !UUID_PATTERN.test(organizationId)) {
      throw new BadRequestException("x-organization-id must be a UUID");
    }
    this.tenantContext.run(organizationId, next);
  }
}

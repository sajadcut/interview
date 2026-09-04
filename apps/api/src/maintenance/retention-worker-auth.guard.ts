import { timingSafeEqual } from "node:crypto";
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";

export const RETENTION_WORKER_SECRET_HEADER = "x-retention-worker-secret";

function constantTimeMatch(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

@Injectable()
export class RetentionWorkerAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.RETENTION_WORKER_SHARED_SECRET?.trim() ?? "";
    if (!expected) {
      throw new ServiceUnavailableException(
        "Retention worker API is disabled until RETENTION_WORKER_SHARED_SECRET is configured",
      );
    }
    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.header(RETENTION_WORKER_SECRET_HEADER)?.trim() ?? "";
    if (!provided || !constantTimeMatch(provided, expected)) {
      throw new UnauthorizedException("Invalid retention worker credentials");
    }
    return true;
  }
}

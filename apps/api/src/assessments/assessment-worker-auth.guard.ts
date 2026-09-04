import { timingSafeEqual } from "node:crypto";
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";

export const ASSESSMENT_WORKER_SECRET_HEADER = "x-assessment-worker-secret";

function constantTimeMatch(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

@Injectable()
export class AssessmentWorkerAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.ASSESSMENT_WORKER_SHARED_SECRET?.trim() ?? "";
    if (!expected) {
      throw new ServiceUnavailableException(
        "Assessment worker API is disabled until ASSESSMENT_WORKER_SHARED_SECRET is configured",
      );
    }

    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.header(ASSESSMENT_WORKER_SECRET_HEADER)?.trim() ?? "";
    if (!provided || !constantTimeMatch(provided, expected)) {
      throw new UnauthorizedException("Invalid assessment worker credentials");
    }
    return true;
  }
}

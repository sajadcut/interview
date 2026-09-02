import { timingSafeEqual } from "node:crypto";
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";

export const AI_WORKER_SECRET_HEADER = "x-ai-worker-secret";

function constantTimeMatch(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

@Injectable()
export class AiWorkerAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.AI_WORKER_SHARED_SECRET?.trim() ?? "";
    if (!expected) {
      throw new ServiceUnavailableException("AI worker API is disabled until AI_WORKER_SHARED_SECRET is configured");
    }

    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.header(AI_WORKER_SECRET_HEADER)?.trim() ?? "";
    if (!provided || !constantTimeMatch(provided, expected)) {
      throw new UnauthorizedException("Invalid AI worker credentials");
    }
    return true;
  }
}

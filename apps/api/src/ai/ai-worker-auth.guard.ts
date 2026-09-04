import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import {
  constantTimeSecretMatch,
  requireSharedSecret,
} from "../common/security/secrets";

export const AI_WORKER_SECRET_HEADER = "x-ai-worker-secret";

@Injectable()
export class AiWorkerAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = requireSharedSecret("AI_WORKER_SHARED_SECRET");
    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.header(AI_WORKER_SECRET_HEADER)?.trim() ?? "";
    if (!provided || !constantTimeSecretMatch(provided, expected)) {
      throw new UnauthorizedException("Invalid AI worker credentials");
    }
    return true;
  }
}

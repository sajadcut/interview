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

export const RETENTION_WORKER_SECRET_HEADER = "x-retention-worker-secret";

@Injectable()
export class RetentionWorkerAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = requireSharedSecret("RETENTION_WORKER_SHARED_SECRET");
    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.header(RETENTION_WORKER_SECRET_HEADER)?.trim() ?? "";
    if (!provided || !constantTimeSecretMatch(provided, expected)) {
      throw new UnauthorizedException("Invalid retention worker credentials");
    }
    return true;
  }
}

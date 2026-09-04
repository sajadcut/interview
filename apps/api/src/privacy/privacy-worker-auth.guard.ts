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

export const PRIVACY_WORKER_SECRET_HEADER = "x-privacy-worker-secret";

@Injectable()
export class PrivacyWorkerAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = requireSharedSecret("PRIVACY_WORKER_SHARED_SECRET");
    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.header(PRIVACY_WORKER_SECRET_HEADER)?.trim() ?? "";
    if (!provided || !constantTimeSecretMatch(provided, expected)) {
      throw new UnauthorizedException("Invalid privacy worker credentials");
    }
    return true;
  }
}

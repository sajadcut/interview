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

export const ASSESSMENT_WORKER_SECRET_HEADER = "x-assessment-worker-secret";

@Injectable()
export class AssessmentWorkerAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = requireSharedSecret("ASSESSMENT_WORKER_SHARED_SECRET");
    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.header(ASSESSMENT_WORKER_SECRET_HEADER)?.trim() ?? "";
    if (!provided || !constantTimeSecretMatch(provided, expected)) {
      throw new UnauthorizedException("Invalid assessment worker credentials");
    }
    return true;
  }
}

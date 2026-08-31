import { Injectable, Logger, type CallHandler, type ExecutionContext, type NestInterceptor } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { tap, type Observable } from "rxjs";
import type { RequestWithContext } from "../common/http/correlation-id.middleware";
import { AUDITED_ACTION_KEY, type AuditedActionMetadata } from "./audited-action.decorator";
import { AuditService } from "./audit.service";

const auditedParamOrder = [
  "id",
  "applicationId",
  "jobId",
  "sessionId",
  "releaseUnitId",
  "assessmentId",
] as const;

function resolveEntityId(params: Record<string, unknown>): string | undefined {
  for (const key of auditedParamOrder) {
    const value = params[key];
    if (typeof value === "string" && value) return value;
  }
  return undefined;
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const metadata = this.reflector.getAllAndOverride<AuditedActionMetadata>(AUDITED_ACTION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!metadata) return next.handle();

    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const entityId = resolveEntityId(request.params as Record<string, unknown>);

    return next.handle().pipe(
      tap(() => {
        void this.audit
          .record({
            action: metadata.action,
            entityType: metadata.entityType,
            ...(entityId ? { entityId } : {}),
            metadata: {
              method: request.method,
              path: request.originalUrl,
              requestId: request.requestId ?? null,
            },
          })
          .catch((error: unknown) => {
            this.logger.error("Best-effort request audit write failed", error instanceof Error ? error.stack : undefined);
          });
      }),
    );
  }
}

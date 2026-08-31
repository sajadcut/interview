import { Injectable, Logger, type CallHandler, type ExecutionContext, type NestInterceptor } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { tap, type Observable } from "rxjs";
import type { RequestWithContext } from "../common/http/correlation-id.middleware";
import { AUDITED_ACTION_KEY, type AuditedActionMetadata } from "./audited-action.decorator";
import { AuditService } from "./audit.service";

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
    const entityId = typeof request.params.id === "string" ? request.params.id : undefined;

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

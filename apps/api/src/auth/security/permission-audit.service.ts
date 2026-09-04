import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import { TenantContextService } from "../../tenant/tenant-context.service";
import { AuthContextService } from "../auth-context.service";
import type { Permission } from "../permissions";
import type { TenantAccess } from "../tenant-access.service";

export interface PermissionAuditRequest {
  method?: string;
  path?: string;
  originalUrl?: string;
  requestId?: string;
}

export interface PermissionAuditInput {
  required: readonly Permission[];
  missing?: readonly Permission[];
  request: PermissionAuditRequest;
  access?: TenantAccess;
  reason?: "missing_permissions" | "access_resolution_failed";
}

function safePath(request: PermissionAuditRequest): string | null {
  if (request.path?.trim()) return request.path.trim();
  const original = request.originalUrl?.trim();
  if (!original) return null;
  return original.split("?", 1)[0] ?? null;
}

@Injectable()
export class PermissionAuditService {
  private readonly logger = new Logger(PermissionAuditService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
    private readonly authContext: AuthContextService,
  ) {}

  async recordDenied(input: PermissionAuditInput): Promise<void> {
    try {
      await this.record("authorization.permission.denied", input);
    } catch (error) {
      // A denial must remain a denial even if the audit write is unavailable.
      this.logger.warn(
        "Permission denial audit write failed",
        error instanceof Error ? error.message : undefined,
      );
    }
  }

  async recordGranted(input: PermissionAuditInput): Promise<void> {
    // Privileged state changes fail closed if their permission decision cannot be audited.
    await this.record("authorization.permission.granted", input);
  }

  private async record(
    action: "authorization.permission.denied" | "authorization.permission.granted",
    input: PermissionAuditInput,
  ): Promise<void> {
    const tenant = this.tenantContext.getOptional();
    const principal = this.authContext.getOptional();
    const organizationId = input.access?.organizationId ?? tenant?.organizationId;
    const userId = input.access?.userId ?? principal?.userId;
    if (!organizationId || !userId) return;

    const metadata = {
      requiredPermissions: [...input.required],
      missingPermissions: [...(input.missing ?? [])],
      method: input.request.method?.toUpperCase() ?? null,
      path: safePath(input.request),
      requestId: input.request.requestId ?? null,
      membershipId: input.access?.membershipId ?? null,
      platformAdmin: input.access?.platformAdmin ?? false,
      authSource: principal?.source ?? null,
    };

    await this.database.sql`
      INSERT INTO audit_events (
        organization_id, actor_type, actor_user_id, action, entity_type, entity_id,
        reason, metadata
      ) VALUES (
        ${organizationId}::uuid,
        'user',
        ${userId}::uuid,
        ${action},
        'permission_check',
        NULL,
        ${input.reason ?? null},
        ${this.database.sql.json(metadata as never)}
      )
    `;
  }
}

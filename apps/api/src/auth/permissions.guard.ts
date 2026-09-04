import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { RequestWithContext } from "../common/http/correlation-id.middleware";
import { Permissions, type Permission } from "./permissions";
import { REQUIRED_PERMISSIONS_KEY } from "./require-permissions.decorator";
import { PermissionAuditService } from "./security/permission-audit.service";
import { TenantAccessService } from "./tenant-access.service";

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const HIGH_RISK_READ_PERMISSIONS = new Set<Permission>([
  Permissions.AuditRead,
  Permissions.PrivacyManage,
  Permissions.OrganizationManage,
  Permissions.OrganizationManageUsers,
  Permissions.IntegrationManage,
]);

export function shouldAuditPermissionGrant(
  method: string | undefined,
  required: readonly Permission[],
): boolean {
  if (method && STATE_CHANGING_METHODS.has(method.toUpperCase())) return true;
  return required.some((permission) => HIGH_RISK_READ_PERMISSIONS.has(permission));
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenantAccess: TenantAccessService,
    private readonly permissionAudit: PermissionAuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Permission[]>(REQUIRED_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const request = context.switchToHttp().getRequest<RequestWithContext>();
    let access;
    try {
      access = await this.tenantAccess.requireCurrentAccess();
    } catch (error) {
      await this.permissionAudit.recordDenied({
        required,
        missing: required,
        request,
        reason: "access_resolution_failed",
      });
      throw error;
    }

    const missing = required.filter((permission) => !access.permissions.has(permission));
    if (missing.length) {
      await this.permissionAudit.recordDenied({
        required,
        missing,
        request,
        access,
        reason: "missing_permissions",
      });
      throw new ForbiddenException(`Missing permissions: ${missing.join(", ")}`);
    }

    if (shouldAuditPermissionGrant(request.method, required)) {
      await this.permissionAudit.recordGranted({ required, request, access });
    }
    return true;
  }
}

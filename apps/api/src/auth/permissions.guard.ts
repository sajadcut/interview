import { ForbiddenException, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { REQUIRED_PERMISSIONS_KEY } from "./require-permissions.decorator";
import type { Permission } from "./permissions";
import { TenantAccessService } from "./tenant-access.service";

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenantAccess: TenantAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Permission[]>(REQUIRED_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const access = await this.tenantAccess.requireCurrentAccess();
    const missing = required.filter((permission) => !access.permissions.has(permission));
    if (missing.length) {
      throw new ForbiddenException(`Missing permissions: ${missing.join(", ")}`);
    }
    return true;
  }
}

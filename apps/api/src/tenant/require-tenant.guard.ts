import { type CanActivate, type ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { TenantAccessService } from "../auth/tenant-access.service";
import { REQUIRE_TENANT_KEY } from "./require-tenant.decorator";

@Injectable()
export class RequireTenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenantAccess: TenantAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean>(REQUIRE_TENANT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;
    await this.tenantAccess.requireCurrentAccess();
    return true;
  }
}

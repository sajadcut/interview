import { BadRequestException, type CanActivate, type ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { REQUIRE_TENANT_KEY } from "./require-tenant.decorator";
import { TenantContextService } from "./tenant-context.service";

@Injectable()
export class RequireTenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenantContext: TenantContextService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<boolean>(REQUIRE_TENANT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;
    if (!this.tenantContext.getOptional()) {
      throw new BadRequestException("x-organization-id is required");
    }
    return true;
  }
}

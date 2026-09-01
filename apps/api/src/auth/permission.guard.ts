import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PERMISSION_KEY } from "./permission.decorator";
import { hasPermission, type PlatformRole } from "./rbac.constants";

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const permissions = this.reflector.getAllAndOverride<string[]>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!permissions?.length) return true;

    const request = context.switchToHttp().getRequest<{
      user?: { role?: PlatformRole };
    }>();
    const role = request.user?.role;

    return !!role && permissions.every((permission) => hasPermission(role, permission));
  }
}

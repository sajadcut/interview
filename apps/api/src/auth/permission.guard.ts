import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRED_PERMISSION } from './permission.decorator';
import { hasPermission, PlatformRole } from './rbac.constants';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const permission = this.reflector.get<string>(
      REQUIRED_PERMISSION,
      context.getHandler(),
    );

    if (!permission) return true;

    const request = context.switchToHttp().getRequest();
    const role = request.user?.role as PlatformRole | undefined;

    return !!role && hasPermission(role, permission);
  }
}

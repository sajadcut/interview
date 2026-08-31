import { Global, MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { RequireTenantGuard } from "../tenant/require-tenant.guard";
import { TenantModule } from "../tenant/tenant.module";
import { AuthContextService } from "./auth-context.service";
import { DevAuthMiddleware } from "./dev-auth.middleware";
import { PermissionsGuard } from "./permissions.guard";
import { TenantAccessService } from "./tenant-access.service";

@Global()
@Module({
  imports: [TenantModule],
  providers: [
    AuthContextService,
    DevAuthMiddleware,
    TenantAccessService,
    { provide: APP_GUARD, useClass: RequireTenantGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [AuthContextService, TenantAccessService],
})
export class AuthorizationModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(DevAuthMiddleware).forRoutes("*");
  }
}

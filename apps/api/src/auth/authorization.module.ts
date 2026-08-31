import { Global, MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthContextService } from "./auth-context.service";
import { DevAuthMiddleware } from "./dev-auth.middleware";
import { PermissionsGuard } from "./permissions.guard";

@Global()
@Module({
  providers: [
    AuthContextService,
    DevAuthMiddleware,
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [AuthContextService],
})
export class AuthorizationModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(DevAuthMiddleware).forRoutes("*");
  }
}

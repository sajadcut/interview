import {
  Global,
  MiddlewareConsumer,
  Module,
  type NestModule,
} from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { RequireTenantGuard } from "./require-tenant.guard";
import { TenantContextMiddleware } from "./tenant-context.middleware";
import { TenantContextService } from "./tenant-context.service";

@Global()
@Module({
  providers: [
    TenantContextService,
    TenantContextMiddleware,
    { provide: APP_GUARD, useClass: RequireTenantGuard },
  ],
  exports: [TenantContextService],
})
export class TenantModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantContextMiddleware).forRoutes("*");
  }
}

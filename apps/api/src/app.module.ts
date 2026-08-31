import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { AppController } from "./app.controller";
import { AuditModule } from "./audit/audit.module";
import { AuthorizationModule } from "./auth/authorization.module";
import { correlationIdMiddleware } from "./common/http/correlation-id.middleware";
import { DatabaseModule } from "./database/database.module";
import { HealthController } from "./health/health.controller";
import { StorageModule } from "./storage/storage.module";
import { TenantModule } from "./tenant/tenant.module";

@Module({
  imports: [DatabaseModule, TenantModule, AuthorizationModule, AuditModule, StorageModule],
  controllers: [AppController, HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(correlationIdMiddleware).forRoutes("*");
  }
}

import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { AppController } from "./app.controller";
import { correlationIdMiddleware } from "./common/http/correlation-id.middleware";
import { HealthController } from "./health/health.controller";

@Module({
  controllers: [AppController, HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(correlationIdMiddleware).forRoutes("*");
  }
}

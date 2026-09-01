import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { AiModule } from "./ai/ai.module";
import { AnalyticsModule } from "./analytics/analytics.module";
import { AppController } from "./app.controller";
import { AssessmentsModule } from "./assessments/assessments.module";
import { AuditModule } from "./audit/audit.module";
import { AuthorizationModule } from "./auth/authorization.module";
import { correlationIdMiddleware } from "./common/http/correlation-id.middleware";
import { csrfProtectionMiddleware } from "./common/http/csrf.middleware";
import { securityHeadersMiddleware } from "./common/http/security-headers.middleware";
import { DatabaseModule } from "./database/database.module";
import { EngagementModule } from "./engagement/engagement.module";
import { HealthController } from "./health/health.controller";
import { InterviewsModule } from "./interviews/interviews.module";
import { InterviewerModule } from "./interviewer/interviewer.module";
import { MetricsController } from "./metrics/metrics.controller";
import { MetricsMiddleware } from "./metrics/metrics.middleware";
import { MetricsService } from "./metrics/metrics.service";
import { ProductOperationsModule } from "./operations/product-operations.module";
import { OrganizationsModule } from "./organizations/organizations.module";
import { PrivacyModule } from "./privacy/privacy.module";
import { RecruitingModule } from "./recruiting/recruiting.module";
import { SourcingModule } from "./sourcing/sourcing.module";
import { StorageModule } from "./storage/storage.module";
import { TenantModule } from "./tenant/tenant.module";

@Module({
  imports: [
    DatabaseModule,
    TenantModule,
    AuthorizationModule,
    AuditModule,
    OrganizationsModule,
    StorageModule,
    AiModule,
    RecruitingModule,
    SourcingModule,
    EngagementModule,
    InterviewsModule,
    InterviewerModule,
    AssessmentsModule,
    AnalyticsModule,
    PrivacyModule,
    ProductOperationsModule,
  ],
  controllers: [AppController, HealthController, MetricsController],
  providers: [MetricsService, MetricsMiddleware],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(
        correlationIdMiddleware,
        securityHeadersMiddleware,
        csrfProtectionMiddleware,
        MetricsMiddleware,
      )
      .forRoutes("*");
  }
}

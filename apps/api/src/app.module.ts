import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { AiModule } from "./ai/ai.module";
import { AnalyticsModule } from "./analytics/analytics.module";
import { AppController } from "./app.controller";
import { AssessmentsModule } from "./assessments/assessments.module";
import { AuditModule } from "./audit/audit.module";
import { AuthorizationModule } from "./auth/authorization.module";
import { correlationIdMiddleware } from "./common/http/correlation-id.middleware";
import { DatabaseModule } from "./database/database.module";
import { EngagementModule } from "./engagement/engagement.module";
import { HealthController } from "./health/health.controller";
import { InterviewsModule } from "./interviews/interviews.module";
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
    AssessmentsModule,
    AnalyticsModule,
    PrivacyModule,
  ],
  controllers: [AppController, HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(correlationIdMiddleware).forRoutes("*");
  }
}

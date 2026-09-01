import { Global, MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { RequireTenantGuard } from "../tenant/require-tenant.guard";
import { TenantModule } from "../tenant/tenant.module";
import { AuthContextService } from "./auth-context.service";
import { AuthController } from "./auth.controller";
import { AuthMiddleware } from "./auth.middleware";
import { CandidateAuthController } from "./candidate-auth.controller";
import { CandidateAuthService } from "./candidate-auth.service";
import { CandidateConsentController } from "./candidate-consent.controller";
import { CandidateConsentService } from "./candidate-consent.service";
import { CandidateSessionService } from "./candidate-session.service";
import { EnterpriseAuthService } from "./enterprise-auth.service";
import { PasswordHasherService } from "./password-hasher.service";
import { PermissionsGuard } from "./permissions.guard";
import { AuthRateLimitService } from "./security/auth-rate-limit.service";
import { SessionService } from "./session.service";
import { TenantAccessService } from "./tenant-access.service";

@Global()
@Module({
  imports: [TenantModule],
  controllers: [AuthController, CandidateAuthController, CandidateConsentController],
  providers: [
    AuthContextService,
    AuthMiddleware,
    AuthRateLimitService,
    CandidateAuthService,
    CandidateConsentService,
    CandidateSessionService,
    EnterpriseAuthService,
    PasswordHasherService,
    SessionService,
    TenantAccessService,
    { provide: APP_GUARD, useClass: RequireTenantGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [
    AuthContextService,
    AuthRateLimitService,
    CandidateAuthService,
    CandidateConsentService,
    CandidateSessionService,
    EnterpriseAuthService,
    PasswordHasherService,
    SessionService,
    TenantAccessService,
  ],
})
export class AuthorizationModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AuthMiddleware).forRoutes("*");
  }
}

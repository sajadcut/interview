import { Module } from "@nestjs/common";
import { ConfiguredEmailProvider } from "./configured-email.provider";
import {
  DisabledCalendarProvider,
  DisabledEmailProvider,
} from "./disabled-engagement.providers";
import { EmailDeliveryService } from "./email-delivery.service";
import {
  CALENDAR_PROVIDER,
  EMAIL_PROVIDER,
} from "./engagement-provider.contracts";
import {
  SendGridEmailProvider,
  SesEmailProvider,
  SmtpEmailProvider,
} from "./email.providers";
import { EngagementOperationsController } from "./engagement-operations.controller";
import { EngagementOperationsService } from "./engagement-operations.service";
import { EngagementWorkspaceController } from "./engagement-workspace.controller";
import { EngagementWorkspaceService } from "./engagement-workspace.service";
import { EngagementController } from "./engagement.controller";
import { EngagementService } from "./engagement.service";

@Module({
  controllers: [
    EngagementController,
    EngagementOperationsController,
    EngagementWorkspaceController,
  ],
  providers: [
    EngagementService,
    EngagementOperationsService,
    EngagementWorkspaceService,
    EmailDeliveryService,
    DisabledEmailProvider,
    SmtpEmailProvider,
    SesEmailProvider,
    SendGridEmailProvider,
    ConfiguredEmailProvider,
    DisabledCalendarProvider,
    { provide: EMAIL_PROVIDER, useExisting: ConfiguredEmailProvider },
    { provide: CALENDAR_PROVIDER, useExisting: DisabledCalendarProvider },
  ],
  exports: [
    EngagementService,
    EngagementOperationsService,
    EngagementWorkspaceService,
    EmailDeliveryService,
    EMAIL_PROVIDER,
    CALENDAR_PROVIDER,
  ],
})
export class EngagementModule {}

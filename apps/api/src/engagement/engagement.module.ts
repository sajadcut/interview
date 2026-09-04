import { Module } from "@nestjs/common";
import { CalendarDeliveryService } from "./calendar-delivery.service";
import { GoogleCalendarProvider, MicrosoftCalendarProvider } from "./calendar.providers";
import { ConfiguredCalendarProvider } from "./configured-calendar.provider";
import { ConfiguredEmailProvider } from "./configured-email.provider";
import { DeliveryAwareEngagementService } from "./delivery-aware-engagement.service";
import {
  DisabledCalendarProvider,
  DisabledEmailProvider,
} from "./disabled-engagement.providers";
import { EmailDeliveryService } from "./email-delivery.service";
import {
  SendGridEmailProvider,
  SesEmailProvider,
  SmtpEmailProvider,
} from "./email.providers";
import {
  CALENDAR_PROVIDER,
  EMAIL_PROVIDER,
} from "./engagement-provider.contracts";
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
    DeliveryAwareEngagementService,
    { provide: EngagementService, useExisting: DeliveryAwareEngagementService },
    EngagementOperationsService,
    EngagementWorkspaceService,
    EmailDeliveryService,
    CalendarDeliveryService,
    DisabledEmailProvider,
    SmtpEmailProvider,
    SesEmailProvider,
    SendGridEmailProvider,
    ConfiguredEmailProvider,
    DisabledCalendarProvider,
    GoogleCalendarProvider,
    MicrosoftCalendarProvider,
    ConfiguredCalendarProvider,
    { provide: EMAIL_PROVIDER, useExisting: ConfiguredEmailProvider },
    { provide: CALENDAR_PROVIDER, useExisting: ConfiguredCalendarProvider },
  ],
  exports: [
    EngagementService,
    EngagementOperationsService,
    EngagementWorkspaceService,
    EmailDeliveryService,
    CalendarDeliveryService,
    EMAIL_PROVIDER,
    CALENDAR_PROVIDER,
  ],
})
export class EngagementModule {}

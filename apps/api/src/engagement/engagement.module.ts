import { Module } from "@nestjs/common";
import {
  DisabledCalendarProvider,
  DisabledEmailProvider,
} from "./disabled-engagement.providers";
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
    EngagementService,
    EngagementOperationsService,
    EngagementWorkspaceService,
    DisabledEmailProvider,
    DisabledCalendarProvider,
    { provide: EMAIL_PROVIDER, useExisting: DisabledEmailProvider },
    { provide: CALENDAR_PROVIDER, useExisting: DisabledCalendarProvider },
  ],
  exports: [
    EngagementService,
    EngagementOperationsService,
    EngagementWorkspaceService,
    EMAIL_PROVIDER,
    CALENDAR_PROVIDER,
  ],
})
export class EngagementModule {}

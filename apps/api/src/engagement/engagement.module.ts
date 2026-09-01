import { Module } from "@nestjs/common";
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
  providers: [EngagementService, EngagementOperationsService, EngagementWorkspaceService],
  exports: [EngagementService, EngagementOperationsService, EngagementWorkspaceService],
})
export class EngagementModule {}

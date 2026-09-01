import { Module } from "@nestjs/common";
import { EngagementOperationsController } from "./engagement-operations.controller";
import { EngagementOperationsService } from "./engagement-operations.service";
import { EngagementController } from "./engagement.controller";
import { EngagementService } from "./engagement.service";

@Module({
  controllers: [EngagementController, EngagementOperationsController],
  providers: [EngagementService, EngagementOperationsService],
  exports: [EngagementService, EngagementOperationsService],
})
export class EngagementModule {}

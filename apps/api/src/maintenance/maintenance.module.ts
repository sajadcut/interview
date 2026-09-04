import { Module } from "@nestjs/common";
import { MaintenanceController } from "./maintenance.controller";
import { MaintenanceService } from "./maintenance.service";
import { RetentionQueueService } from "./retention-queue.service";
import { RetentionWorkerAuthGuard } from "./retention-worker-auth.guard";
import { RetentionWorkerController } from "./retention-worker.controller";

@Module({
  controllers: [MaintenanceController, RetentionWorkerController],
  providers: [MaintenanceService, RetentionQueueService, RetentionWorkerAuthGuard],
  exports: [MaintenanceService, RetentionQueueService],
})
export class MaintenanceModule {}

import { Module } from "@nestjs/common";
import { PrivacyDeletionLegalHoldService } from "./privacy-deletion-legal-hold.service";
import { PrivacyDeletionQueueService } from "./privacy-deletion-queue.service";
import { PrivacyController } from "./privacy.controller";
import { PrivacyService } from "./privacy.service";
import { PrivacyWorkerAuthGuard } from "./privacy-worker-auth.guard";
import { PrivacyWorkerController } from "./privacy-worker.controller";

@Module({
  controllers: [PrivacyController, PrivacyWorkerController],
  providers: [
    PrivacyService,
    PrivacyDeletionQueueService,
    PrivacyDeletionLegalHoldService,
    PrivacyWorkerAuthGuard,
  ],
  exports: [PrivacyDeletionQueueService],
})
export class PrivacyModule {}

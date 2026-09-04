import { Module } from "@nestjs/common";
import {
  AssessmentOperationsController,
  CandidateAssessmentsController,
} from "./assessment-operations.controller";
import { AssessmentOperationsService } from "./assessment-operations.service";
import { AssessmentWorkerAuthGuard } from "./assessment-worker-auth.guard";
import { AssessmentWorkerController } from "./assessment-worker.controller";
import { AssessmentWorkerQueueService } from "./assessment-worker-queue.service";
import { AssessmentsController } from "./assessments.controller";
import { AssessmentsService } from "./assessments.service";

@Module({
  controllers: [
    AssessmentsController,
    AssessmentOperationsController,
    CandidateAssessmentsController,
    AssessmentWorkerController,
  ],
  providers: [
    AssessmentsService,
    AssessmentOperationsService,
    AssessmentWorkerQueueService,
    AssessmentWorkerAuthGuard,
  ],
  exports: [AssessmentsService, AssessmentOperationsService, AssessmentWorkerQueueService],
})
export class AssessmentsModule {}

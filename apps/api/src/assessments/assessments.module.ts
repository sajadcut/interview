import { Module } from "@nestjs/common";
import {
  AssessmentOperationsController,
  CandidateAssessmentsController,
} from "./assessment-operations.controller";
import { AssessmentOperationsService } from "./assessment-operations.service";
import { AssessmentsController } from "./assessments.controller";
import { AssessmentsService } from "./assessments.service";

@Module({
  controllers: [AssessmentsController, AssessmentOperationsController, CandidateAssessmentsController],
  providers: [AssessmentsService, AssessmentOperationsService],
  exports: [AssessmentsService, AssessmentOperationsService],
})
export class AssessmentsModule {}

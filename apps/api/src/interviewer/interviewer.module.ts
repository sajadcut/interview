import { Module } from "@nestjs/common";
import { InterviewAssignmentAdminController } from "./interview-assignment-admin.controller";
import { InterviewAssignmentAdminService } from "./interview-assignment-admin.service";
import { InterviewerController } from "./interviewer.controller";
import { InterviewerService } from "./interviewer.service";

@Module({
  controllers: [InterviewAssignmentAdminController, InterviewerController],
  providers: [InterviewAssignmentAdminService, InterviewerService],
  exports: [InterviewAssignmentAdminService, InterviewerService],
})
export class InterviewerModule {}

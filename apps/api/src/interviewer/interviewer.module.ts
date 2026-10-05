import { Module } from "@nestjs/common";
import { OrganizationsModule } from "../organizations/organizations.module";
import { InterviewAssignmentAdminController } from "./interview-assignment-admin.controller";
import { InterviewAssignmentAdminService } from "./interview-assignment-admin.service";
import { InterviewerController } from "./interviewer.controller";
import { InterviewerProfileController } from "./interviewer-profile.controller";
import { InterviewerProfileService } from "./interviewer-profile.service";
import { InterviewerService } from "./interviewer.service";

@Module({
  imports: [OrganizationsModule],
  controllers: [InterviewAssignmentAdminController, InterviewerController, InterviewerProfileController],
  providers: [InterviewAssignmentAdminService, InterviewerService, InterviewerProfileService],
  exports: [InterviewAssignmentAdminService, InterviewerService, InterviewerProfileService],
})
export class InterviewerModule {}

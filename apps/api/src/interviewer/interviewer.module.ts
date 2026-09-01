import { Module } from "@nestjs/common";
import { InterviewerController } from "./interviewer.controller";
import { InterviewerService } from "./interviewer.service";

@Module({
  controllers: [InterviewerController],
  providers: [InterviewerService],
  exports: [InterviewerService],
})
export class InterviewerModule {}

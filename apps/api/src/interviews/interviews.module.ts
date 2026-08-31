import { Module } from "@nestjs/common";
import { InterviewBrainService } from "./interview-brain.service";
import { InterviewsController } from "./interviews.controller";
import { InterviewsService } from "./interviews.service";

@Module({
  controllers: [InterviewsController],
  providers: [InterviewsService, InterviewBrainService],
  exports: [InterviewsService, InterviewBrainService],
})
export class InterviewsModule {}

import { Module } from "@nestjs/common";
import { InterviewBrainService } from "./interview-brain.service";
import { InterviewMediaController } from "./interview-media.controller";
import { InterviewMediaService } from "./interview-media.service";
import { InterviewsController } from "./interviews.controller";
import { InterviewsService } from "./interviews.service";

@Module({
  controllers: [InterviewsController, InterviewMediaController],
  providers: [InterviewsService, InterviewBrainService, InterviewMediaService],
  exports: [InterviewsService, InterviewBrainService, InterviewMediaService],
})
export class InterviewsModule {}

import { Module } from "@nestjs/common";
import { InterviewBrainService } from "./interview-brain.service";
import { InterviewMediaController } from "./interview-media.controller";
import { InterviewMediaService } from "./interview-media.service";
import { InterviewSpeechService } from "./interview-speech.service";
import { InterviewsController } from "./interviews.controller";
import { InterviewsService } from "./interviews.service";

@Module({
  controllers: [InterviewsController, InterviewMediaController],
  providers: [InterviewsService, InterviewBrainService, InterviewMediaService, InterviewSpeechService],
  exports: [InterviewsService, InterviewBrainService, InterviewMediaService, InterviewSpeechService],
})
export class InterviewsModule {}

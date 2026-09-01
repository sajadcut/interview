import { Module } from "@nestjs/common";
import { InterviewBrainService } from "./interview-brain.service";
import { InterviewMediaController } from "./interview-media.controller";
import { InterviewMediaService } from "./interview-media.service";
import { InterviewOrchestrationController } from "./interview-orchestration.controller";
import { InterviewOrchestrationService } from "./interview-orchestration.service";
import { InterviewSpeechService } from "./interview-speech.service";
import { InterviewsController } from "./interviews.controller";
import { InterviewsService } from "./interviews.service";

@Module({
  controllers: [InterviewsController, InterviewMediaController, InterviewOrchestrationController],
  providers: [
    InterviewsService,
    InterviewBrainService,
    InterviewMediaService,
    InterviewSpeechService,
    InterviewOrchestrationService,
  ],
  exports: [
    InterviewsService,
    InterviewBrainService,
    InterviewMediaService,
    InterviewSpeechService,
    InterviewOrchestrationService,
  ],
})
export class InterviewsModule {}

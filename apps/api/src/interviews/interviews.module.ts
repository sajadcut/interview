import { Module } from "@nestjs/common";
import { InterviewBrainService } from "./interview-brain.service";
import { InterviewEvaluatorService } from "./interview-evaluator.service";
import { InterviewMediaController } from "./interview-media.controller";
import { InterviewMediaEventService } from "./interview-media-event.service";
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
    InterviewEvaluatorService,
    InterviewMediaService,
    InterviewMediaEventService,
    InterviewSpeechService,
    InterviewOrchestrationService,
  ],
  exports: [
    InterviewsService,
    InterviewBrainService,
    InterviewEvaluatorService,
    InterviewMediaService,
    InterviewMediaEventService,
    InterviewSpeechService,
    InterviewOrchestrationService,
  ],
})
export class InterviewsModule {}

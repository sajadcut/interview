import { Module } from "@nestjs/common";
import { EvaluatorCalibrationAnalyticsService } from "./evaluator-calibration-analytics.service";
import { EvaluatorCalibrationController } from "./evaluator-calibration.controller";
import { EvaluatorCalibrationService } from "./evaluator-calibration.service";
import { EvaluatorShadowTestingController } from "./evaluator-shadow-testing.controller";
import { EvaluatorShadowTestingService } from "./evaluator-shadow-testing.service";
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
  controllers: [
    InterviewsController,
    InterviewMediaController,
    InterviewOrchestrationController,
    EvaluatorCalibrationController,
    EvaluatorShadowTestingController,
  ],
  providers: [
    InterviewsService,
    InterviewBrainService,
    InterviewEvaluatorService,
    EvaluatorCalibrationService,
    EvaluatorCalibrationAnalyticsService,
    EvaluatorShadowTestingService,
    InterviewMediaService,
    InterviewMediaEventService,
    InterviewSpeechService,
    InterviewOrchestrationService,
  ],
  exports: [
    InterviewsService,
    InterviewBrainService,
    InterviewEvaluatorService,
    EvaluatorCalibrationService,
    EvaluatorCalibrationAnalyticsService,
    EvaluatorShadowTestingService,
    InterviewMediaService,
    InterviewMediaEventService,
    InterviewSpeechService,
    InterviewOrchestrationService,
  ],
})
export class InterviewsModule {}

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
import { InterviewReleaseGovernanceController } from "./interview-release-governance.controller";
import { InterviewReleaseGovernanceService } from "./interview-release-governance.service";
import { InterviewReviewController } from "./interview-review.controller";
import { InterviewReviewService } from "./interview-review.service";
import { InterviewSessionStateController } from "./interview-session-state.controller";
import { InterviewSessionStateService } from "./interview-session-state.service";
import { InterviewSpeechService } from "./interview-speech.service";
import { InterviewsController } from "./interviews.controller";
import { InterviewsService } from "./interviews.service";
import { LiveKitTransportAdapter } from "./livekit-transport.adapter";
import { REALTIME_TRANSPORT_ADAPTER } from "./realtime-transport.adapter";
import { SileroVadHttpClient } from "./silero-vad-http.client";
import { SPEECH_TO_TEXT_ADAPTER } from "./speech-to-text.adapter";
import { SupervisedPilotAwareInterviewsService } from "./supervised-pilot-aware-interviews.service";
import { SupervisedPilotController } from "./supervised-pilot.controller";
import { SupervisedPilotRuntimeGateService } from "./supervised-pilot-runtime-gate.service";
import { SupervisedPilotService } from "./supervised-pilot.service";
import { TEXT_TO_SPEECH_ADAPTER } from "./text-to-speech.adapter";
import { TtsHttpClient } from "./tts-http.client";
import { VOICE_ACTIVITY_DETECTION_ADAPTER } from "./voice-activity-detection.adapter";
import { WhisperHttpClient } from "./whisper-http.client";

@Module({
  controllers: [
    InterviewsController, InterviewReviewController, InterviewReleaseGovernanceController,
    InterviewSessionStateController, InterviewMediaController, InterviewOrchestrationController,
    EvaluatorCalibrationController, EvaluatorShadowTestingController, SupervisedPilotController,
  ],
  providers: [
    SupervisedPilotRuntimeGateService, SupervisedPilotService, SupervisedPilotAwareInterviewsService,
    { provide: InterviewsService, useExisting: SupervisedPilotAwareInterviewsService },
    InterviewSessionStateService, InterviewBrainService, InterviewEvaluatorService,
    InterviewReviewService, InterviewReleaseGovernanceService,
    EvaluatorCalibrationService, EvaluatorCalibrationAnalyticsService, EvaluatorShadowTestingService,
    LiveKitTransportAdapter, SileroVadHttpClient,
    { provide: VOICE_ACTIVITY_DETECTION_ADAPTER, useExisting: SileroVadHttpClient },
    { provide: REALTIME_TRANSPORT_ADAPTER, useExisting: LiveKitTransportAdapter },
    WhisperHttpClient, { provide: SPEECH_TO_TEXT_ADAPTER, useExisting: WhisperHttpClient },
    TtsHttpClient, { provide: TEXT_TO_SPEECH_ADAPTER, useExisting: TtsHttpClient },
    InterviewMediaService, InterviewMediaEventService, InterviewSpeechService, InterviewOrchestrationService,
  ],
  exports: [
    InterviewsService, InterviewSessionStateService, InterviewBrainService, InterviewEvaluatorService,
    InterviewReviewService, InterviewReleaseGovernanceService,
    EvaluatorCalibrationService, EvaluatorCalibrationAnalyticsService, EvaluatorShadowTestingService,
    LiveKitTransportAdapter, REALTIME_TRANSPORT_ADAPTER, SileroVadHttpClient, VOICE_ACTIVITY_DETECTION_ADAPTER,
    WhisperHttpClient, SPEECH_TO_TEXT_ADAPTER, TtsHttpClient, TEXT_TO_SPEECH_ADAPTER,
    InterviewMediaService, InterviewMediaEventService, InterviewSpeechService, InterviewOrchestrationService,
    SupervisedPilotRuntimeGateService, SupervisedPilotService,
  ],
})
export class InterviewsModule {}

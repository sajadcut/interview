import { InternalInterviewHarness } from "../../../../components/interviews/internal-interview-harness";
import { InternalLiveKitSessionHarness } from "../../../../components/interviews/internal-livekit-session-harness";
import { InternalMediaReadinessPanel } from "../../../../components/interviews/internal-media-readiness-panel";
import { InternalRealtimeInterviewHarness } from "../../../../components/interviews/internal-realtime-interview-harness";
import { InternalSpeechLoopHarness } from "../../../../components/interviews/internal-speech-loop-harness";

export default function InternalInterviewTestPage() {
  return (
    <div className="space-y-4">
      <InternalMediaReadinessPanel />
      <InternalRealtimeInterviewHarness />
      <InternalLiveKitSessionHarness />
      <InternalSpeechLoopHarness />
      <InternalInterviewHarness />
    </div>
  );
}

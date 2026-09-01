import { InternalInterviewHarness } from "../../../../components/interviews/internal-interview-harness";
import { InternalLiveKitSessionHarness } from "../../../../components/interviews/internal-livekit-session-harness";
import { InternalMediaReadinessPanel } from "../../../../components/interviews/internal-media-readiness-panel";

export default function InternalInterviewTestPage() {
  return (
    <div className="space-y-4">
      <InternalMediaReadinessPanel />
      <InternalLiveKitSessionHarness />
      <InternalInterviewHarness />
    </div>
  );
}

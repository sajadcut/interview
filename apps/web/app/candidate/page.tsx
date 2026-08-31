import { CandidateInterviewExperience } from "../../components/candidate/candidate-interview-experience";
import { CandidateRealtimeLaunchGate } from "../../components/candidate/candidate-realtime-launch-gate";

export default function CandidatePage() {
  return (
    <>
      <CandidateRealtimeLaunchGate />
      <CandidateInterviewExperience />
    </>
  );
}

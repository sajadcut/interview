import { CandidateIntelligenceWorkspace } from "../../../../components/recruiting/candidate-intelligence-workspace";

export default async function CandidatePage({ params }: { params: Promise<{ candidateId: string }> }) {
  const { candidateId } = await params;
  return <CandidateIntelligenceWorkspace candidateId={candidateId} />;
}

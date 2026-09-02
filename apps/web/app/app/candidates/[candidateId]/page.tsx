import { CandidatePageWorkspace } from "../../../../components/recruiting/candidate-page-workspace";

export default async function CandidatePage({ params }: { params: Promise<{ candidateId: string }> }) {
  const { candidateId } = await params;
  return <CandidatePageWorkspace candidateId={candidateId} />;
}

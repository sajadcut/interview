import { CandidateEditForm } from "../../../../../components/recruiting/candidate-edit-form";

export default async function CandidateEditPage({ params }: { params: Promise<{ candidateId: string }> }) {
  const { candidateId } = await params;
  return <CandidateEditForm candidateId={candidateId} />;
}

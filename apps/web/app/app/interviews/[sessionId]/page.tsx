import { InterviewReview } from "../../../../components/interviews/interview-review";

export default async function InterviewReviewPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <InterviewReview sessionId={sessionId} />;
}

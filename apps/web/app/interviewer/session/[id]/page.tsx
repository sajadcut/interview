import { InterviewerSession } from "../../../../components/interviewer/interviewer-session";

export default async function InterviewerSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <InterviewerSession sessionId={id} />;
}

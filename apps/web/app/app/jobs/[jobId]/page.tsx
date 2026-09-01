import { JobRecruitingWorkspace } from "../../../../components/recruiting/job-recruiting-workspace";

export default async function JobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  return <JobRecruitingWorkspace jobId={jobId} />;
}

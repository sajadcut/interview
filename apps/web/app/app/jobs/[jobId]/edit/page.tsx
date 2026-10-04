import { JobEditForm } from "../../../../../components/recruiting/job-edit-form";

export default async function JobEditPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  return <JobEditForm jobId={jobId} />;
}

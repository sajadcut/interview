import { JobCreateForm } from "../../../../components/recruiting/job-create-form";

export default async function NewJobPage({
  searchParams,
}: {
  searchParams: Promise<{ hiringRequestId?: string }>;
}) {
  const params = await searchParams;
  return <JobCreateForm {...(params.hiringRequestId ? { hiringRequestId: params.hiringRequestId } : {})} />;
}

import { SearchWorkspace } from "../../../components/system/product-operations-workspaces";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  return <SearchWorkspace initialQuery={params.q ?? ""} />;
}

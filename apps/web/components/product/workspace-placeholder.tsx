import { EmptyState, PageHeader } from "@interview/ui";
import { foundationCopy, getDefaultLocale } from "../../lib/i18n";

export function WorkspacePlaceholder({ title, description }: { title: string; description: string }) {
  const copy = foundationCopy[getDefaultLocale()];
  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} />
      <EmptyState title={copy.workspaceReady} description={copy.workspaceDeferred} />
    </div>
  );
}

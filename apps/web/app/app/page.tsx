import { AiIndicator, Card, EmptyState, PageHeader } from "@interview/ui";
import { SystemHealthCard } from "../../components/system/system-health-card";
import { foundationCopy, getDefaultLocale } from "../../lib/i18n";

export default function CommandCenterPage() {
  const copy = foundationCopy[getDefaultLocale()];
  return (
    <div className="space-y-6">
      <PageHeader title={copy.commandTitle} description={copy.commandDescription} />
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <div className="text-xs text-[var(--muted)]">{copy.attention}</div>
          <div className="mt-2 text-lg font-bold">{copy.noData}</div>
        </Card>
        <Card>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-[var(--muted)]">{copy.aiActivity}</span>
            <AiIndicator label={copy.aiSuggestion} />
          </div>
          <div className="mt-2 text-lg font-bold">{copy.aiReady}</div>
        </Card>
        <SystemHealthCard />
      </div>
      <EmptyState title={copy.firstJobTitle} description={copy.firstJobDescription} />
    </div>
  );
}

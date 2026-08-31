import { Card, PageHeader } from "@interview/ui";
import { foundationCopy, getDefaultLocale } from "../../lib/i18n";

export default function CandidatePage() {
  const copy = foundationCopy[getDefaultLocale()];
  return (
    <div className="space-y-6">
      <PageHeader title={copy.candidateTitle} description={copy.candidateDescription} />
      <Card>
        <h2 className="font-bold">{copy.candidateSurfaceTitle}</h2>
        <p className="mt-2 text-sm leading-7 text-[var(--muted)]">{copy.candidateSurfaceDescription}</p>
      </Card>
    </div>
  );
}

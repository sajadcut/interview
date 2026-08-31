import { Card } from "../ui/card";

export interface EvidenceItem {
  source: string;
  reference: string;
  excerpt: string;
}

export function EvidenceBlock({ title, items }: { title: string; items: EvidenceItem[] }) {
  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-bold">{title}</h3>
        <span className="text-xs text-[var(--muted)]">{items.length} شاهد</span>
      </div>
      <div className="mt-4 divide-y divide-[var(--border)]">
        {items.map((item) => (
          <div key={`${item.source}-${item.reference}`} className="py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap gap-2 text-xs font-semibold">
              <span>{item.source}</span>
              <span className="text-[var(--muted)]">{item.reference}</span>
            </div>
            <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{item.excerpt}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

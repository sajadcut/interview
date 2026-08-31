import { Badge } from "./badge";

const toneByStatus = {
  draft: "neutral",
  open: "success",
  review: "warning",
  blocked: "danger",
  closed: "neutral",
} as const;

export type FoundationStatus = keyof typeof toneByStatus;

export function StatusBadge({ status, label = status }: { status: FoundationStatus; label?: string }) {
  return <Badge tone={toneByStatus[status]}>{label}</Badge>;
}

import { Badge } from "../ui/badge";

const toneByStatus = {
  draft: "neutral",
  open: "success",
  review: "warning",
  blocked: "danger",
  closed: "neutral",
} as const;

export function StatusBadge({ status }: { status: keyof typeof toneByStatus }) {
  return <Badge tone={toneByStatus[status]}>{status}</Badge>;
}

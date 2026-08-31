import { Badge } from "./badge";

export function AiIndicator({
  state = "suggestion",
  label,
}: {
  state?: "suggestion" | "running" | "reviewed";
  label: string;
}) {
  return <Badge tone={state === "reviewed" ? "success" : "accent"}>{label}</Badge>;
}

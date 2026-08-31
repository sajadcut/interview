import { Badge } from "../ui/badge";

export function AiIndicator({ state = "suggestion" }: { state?: "suggestion" | "running" | "reviewed" }) {
  const labels = {
    suggestion: "پیشنهاد AI",
    running: "AI در حال پردازش",
    reviewed: "بررسی‌شده توسط انسان",
  };
  return <Badge tone={state === "reviewed" ? "success" : "accent"}>{labels[state]}</Badge>;
}

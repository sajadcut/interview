"use client";

import { Badge, Card } from "@interview/ui";
import { useHealthQuery } from "../../hooks/use-health-query";

export function SystemHealthCard() {
  const health = useHealthQuery();

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-[var(--muted)]">API</span>
        {health.isSuccess ? <Badge tone="success">online</Badge> : null}
        {health.isPending ? <Badge>checking</Badge> : null}
        {health.isError ? <Badge tone="warning">offline</Badge> : null}
      </div>
      <div className="mt-2 text-lg font-bold">{health.data?.service ?? "interview-api"}</div>
      <div className="mt-1 text-xs text-[var(--muted)]">
        {health.data?.timestamp ?? "Start the local API to connect this workspace."}
      </div>
    </Card>
  );
}

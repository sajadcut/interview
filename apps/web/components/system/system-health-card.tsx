"use client";

import { Badge, Card } from "@interview/ui";
import { useHealthQuery } from "../../hooks/use-health-query";
import { formatFaDateTime } from "../../lib/i18n";

export function SystemHealthCard() {
  const health = useHealthQuery();

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-[var(--muted)]">وضعیت سرویس API</span>
        {health.isSuccess ? <Badge tone="success">برخط</Badge> : null}
        {health.isPending ? <Badge>در حال بررسی</Badge> : null}
        {health.isError ? <Badge tone="warning">قطع ارتباط</Badge> : null}
      </div>
      <div className="mt-2 text-lg font-bold">{health.data?.service ?? "interview-api"}</div>
      <div className="mt-1 text-xs text-[var(--muted)]">
        {health.data?.timestamp ? formatFaDateTime(health.data.timestamp) : "برای اتصال این بخش، سرویس API محلی را اجرا کنید."}
      </div>
    </Card>
  );
}

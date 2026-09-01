import { Injectable } from "@nestjs/common";

interface MetricBucket {
  count: number;
  errorCount: number;
  totalDurationMs: number;
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

@Injectable()
export class MetricsService {
  private readonly requests = new Map<string, MetricBucket>();

  record(method: string, route: string, statusCode: number, durationMs: number): void {
    const normalizedRoute = route.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ":id");
    const key = `${method.toUpperCase()} ${normalizedRoute}`;
    const bucket = this.requests.get(key) ?? { count: 0, errorCount: 0, totalDurationMs: 0 };
    bucket.count += 1;
    if (statusCode >= 500) bucket.errorCount += 1;
    bucket.totalDurationMs += Math.max(0, durationMs);
    this.requests.set(key, bucket);
  }

  renderPrometheus(): string {
    const lines = [
      "# HELP interview_process_uptime_seconds Process uptime in seconds.",
      "# TYPE interview_process_uptime_seconds gauge",
      `interview_process_uptime_seconds ${process.uptime()}`,
      "# HELP interview_process_resident_memory_bytes Resident memory size in bytes.",
      "# TYPE interview_process_resident_memory_bytes gauge",
      `interview_process_resident_memory_bytes ${process.memoryUsage().rss}`,
      "# HELP interview_http_requests_total HTTP requests observed by this API process.",
      "# TYPE interview_http_requests_total counter",
      "# HELP interview_http_request_errors_total HTTP 5xx responses observed by this API process.",
      "# TYPE interview_http_request_errors_total counter",
      "# HELP interview_http_request_duration_ms_total Cumulative request duration in milliseconds.",
      "# TYPE interview_http_request_duration_ms_total counter",
    ];
    for (const [key, bucket] of [...this.requests.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const firstSpace = key.indexOf(" ");
      const method = key.slice(0, firstSpace);
      const route = key.slice(firstSpace + 1);
      const labels = `method="${escapeLabel(method)}",route="${escapeLabel(route)}"`;
      lines.push(`interview_http_requests_total{${labels}} ${bucket.count}`);
      lines.push(`interview_http_request_errors_total{${labels}} ${bucket.errorCount}`);
      lines.push(`interview_http_request_duration_ms_total{${labels}} ${bucket.totalDurationMs.toFixed(3)}`);
    }
    return `${lines.join("\n")}\n`;
  }
}

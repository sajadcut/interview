import { Injectable } from "@nestjs/common";

const HTTP_DURATION_BUCKETS_SECONDS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];
const RESPONSE_CLASSES = ["1xx", "2xx", "3xx", "4xx", "5xx"] as const;

interface MetricBucket {
  count: number;
  errorCount: number;
  totalDurationMs: number;
  durationBucketCounts: number[];
  responseClassCounts: Record<string, number>;
}

export function escapePrometheusLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

export function normalizeMetricsRoute(route: string): string {
  const trimmed = route.trim();
  if (!trimmed || trimmed === "__unmatched__") return "__unmatched__";
  const withoutQuery = trimmed.split("?", 1)[0] ?? trimmed;
  const normalized = withoutQuery
    .split("/")
    .map((segment) => {
      if (!segment) return segment;
      if (segment.startsWith(":")) return segment;
      if (/^\d+$/.test(segment)) return ":id";
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(segment)) {
        return ":id";
      }
      if (/^[A-Za-z0-9_-]{32,}$/.test(segment)) return ":opaque";
      return segment.slice(0, 80);
    })
    .join("/");
  return normalized.slice(0, 200) || "/";
}

function responseClass(statusCode: number): string {
  const classNumber = Math.trunc(statusCode / 100);
  return classNumber >= 1 && classNumber <= 5 ? `${classNumber}xx` : "other";
}

@Injectable()
export class MetricsService {
  private readonly requests = new Map<string, MetricBucket>();
  private readonly collectionErrors = new Map<string, number>();
  private inFlightRequests = 0;

  beginRequest(): void {
    this.inFlightRequests += 1;
  }

  endRequest(): void {
    this.inFlightRequests = Math.max(0, this.inFlightRequests - 1);
  }

  record(method: string, route: string, statusCode: number, durationMs: number): void {
    const normalizedRoute = normalizeMetricsRoute(route);
    const key = `${method.toUpperCase()} ${normalizedRoute}`;
    const bucket = this.requests.get(key) ?? {
      count: 0,
      errorCount: 0,
      totalDurationMs: 0,
      durationBucketCounts: HTTP_DURATION_BUCKETS_SECONDS.map(() => 0),
      responseClassCounts: {},
    };
    const boundedDurationMs = Math.max(0, durationMs);
    const durationSeconds = boundedDurationMs / 1000;
    bucket.count += 1;
    if (statusCode >= 500) bucket.errorCount += 1;
    bucket.totalDurationMs += boundedDurationMs;
    const statusClass = responseClass(statusCode);
    bucket.responseClassCounts[statusClass] = (bucket.responseClassCounts[statusClass] ?? 0) + 1;
    for (let index = 0; index < HTTP_DURATION_BUCKETS_SECONDS.length; index += 1) {
      if (durationSeconds <= HTTP_DURATION_BUCKETS_SECONDS[index]!) {
        bucket.durationBucketCounts[index] = (bucket.durationBucketCounts[index] ?? 0) + 1;
      }
    }
    this.requests.set(key, bucket);
  }

  recordCollectionError(collector: string): void {
    const normalized = collector.trim().slice(0, 64) || "unknown";
    this.collectionErrors.set(normalized, (this.collectionErrors.get(normalized) ?? 0) + 1);
  }

  renderPrometheus(): string {
    const memory = process.memoryUsage();
    const cpu = process.cpuUsage();
    const lines = [
      "# HELP interview_process_uptime_seconds Process uptime in seconds.",
      "# TYPE interview_process_uptime_seconds gauge",
      `interview_process_uptime_seconds ${process.uptime()}`,
      "# HELP interview_process_resident_memory_bytes Resident memory size in bytes.",
      "# TYPE interview_process_resident_memory_bytes gauge",
      `interview_process_resident_memory_bytes ${memory.rss}`,
      "# HELP interview_process_heap_used_bytes V8 heap bytes currently used.",
      "# TYPE interview_process_heap_used_bytes gauge",
      `interview_process_heap_used_bytes ${memory.heapUsed}`,
      "# HELP interview_process_cpu_seconds_total CPU seconds consumed by the API process.",
      "# TYPE interview_process_cpu_seconds_total counter",
      `interview_process_cpu_seconds_total{mode=\"user\"} ${(cpu.user / 1_000_000).toFixed(6)}`,
      `interview_process_cpu_seconds_total{mode=\"system\"} ${(cpu.system / 1_000_000).toFixed(6)}`,
      "# HELP interview_http_requests_in_flight HTTP requests currently being processed by this API process.",
      "# TYPE interview_http_requests_in_flight gauge",
      `interview_http_requests_in_flight ${this.inFlightRequests}`,
      "# HELP interview_http_requests_total HTTP requests observed by this API process.",
      "# TYPE interview_http_requests_total counter",
      "# HELP interview_http_request_errors_total HTTP 5xx responses observed by this API process.",
      "# TYPE interview_http_request_errors_total counter",
      "# HELP interview_http_request_duration_ms_total Cumulative request duration in milliseconds.",
      "# TYPE interview_http_request_duration_ms_total counter",
      "# HELP interview_http_responses_total HTTP responses partitioned by status class.",
      "# TYPE interview_http_responses_total counter",
      "# HELP interview_http_request_duration_seconds Request duration histogram by normalized route.",
      "# TYPE interview_http_request_duration_seconds histogram",
    ];

    for (const [key, bucket] of [...this.requests.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const firstSpace = key.indexOf(" ");
      const method = key.slice(0, firstSpace);
      const route = key.slice(firstSpace + 1);
      const labels = `method=\"${escapePrometheusLabel(method)}\",route=\"${escapePrometheusLabel(route)}\"`;
      lines.push(`interview_http_requests_total{${labels}} ${bucket.count}`);
      lines.push(`interview_http_request_errors_total{${labels}} ${bucket.errorCount}`);
      lines.push(`interview_http_request_duration_ms_total{${labels}} ${bucket.totalDurationMs.toFixed(3)}`);
      for (const statusClass of RESPONSE_CLASSES) {
        lines.push(
          `interview_http_responses_total{${labels},status_class=\"${statusClass}\"} ${bucket.responseClassCounts[statusClass] ?? 0}`,
        );
      }
      if (bucket.responseClassCounts.other) {
        lines.push(
          `interview_http_responses_total{${labels},status_class=\"other\"} ${bucket.responseClassCounts.other}`,
        );
      }
      for (let index = 0; index < HTTP_DURATION_BUCKETS_SECONDS.length; index += 1) {
        lines.push(
          `interview_http_request_duration_seconds_bucket{${labels},le=\"${HTTP_DURATION_BUCKETS_SECONDS[index]}\"} ${bucket.durationBucketCounts[index] ?? 0}`,
        );
      }
      lines.push(`interview_http_request_duration_seconds_bucket{${labels},le=\"+Inf\"} ${bucket.count}`);
      lines.push(
        `interview_http_request_duration_seconds_sum{${labels}} ${(bucket.totalDurationMs / 1000).toFixed(6)}`,
      );
      lines.push(`interview_http_request_duration_seconds_count{${labels}} ${bucket.count}`);
    }

    lines.push(
      "# HELP interview_metrics_collection_errors_total Operational metrics collection failures by collector.",
      "# TYPE interview_metrics_collection_errors_total counter",
    );
    for (const [collector, count] of [...this.collectionErrors.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`interview_metrics_collection_errors_total{collector=\"${escapePrometheusLabel(collector)}\"} ${count}`);
    }

    return `${lines.join("\n")}\n`;
  }
}

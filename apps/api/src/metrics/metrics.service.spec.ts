import assert from "node:assert/strict";
import test from "node:test";
import { MetricsService, normalizeMetricsRoute } from "./metrics.service";

test("metrics route normalization removes high-cardinality identifiers and query strings", () => {
  assert.equal(
    normalizeMetricsRoute("/organizations/11111111-1111-4111-8111-111111111111/users/42?token=secret"),
    "/organizations/:id/users/:id",
  );
  assert.equal(normalizeMetricsRoute("/candidate/abcdefghijklmnopqrstuvwxyz0123456789"), "/candidate/:opaque");
  assert.equal(normalizeMetricsRoute("__unmatched__"), "__unmatched__");
});

test("runtime metrics expose in-flight, status classes and cumulative latency buckets", () => {
  const metrics = new MetricsService();
  metrics.beginRequest();
  metrics.beginRequest();
  metrics.endRequest();
  metrics.record("get", "/jobs/:id", 200, 12);
  metrics.record("get", "/jobs/:id", 503, 600);
  metrics.recordCollectionError("operational_db");

  const text = metrics.renderPrometheus();
  assert.match(text, /interview_http_requests_in_flight 1/);
  assert.match(text, /interview_http_requests_total\{method="GET",route="\/jobs\/:id"\} 2/);
  assert.match(text, /interview_http_request_errors_total\{method="GET",route="\/jobs\/:id"\} 1/);
  assert.match(text, /interview_http_responses_total\{method="GET",route="\/jobs\/:id",status_class="2xx"\} 1/);
  assert.match(text, /interview_http_responses_total\{method="GET",route="\/jobs\/:id",status_class="5xx"\} 1/);
  assert.match(text, /interview_http_request_duration_seconds_bucket\{method="GET",route="\/jobs\/:id",le="1"\} 2/);
  assert.match(text, /interview_http_request_duration_seconds_count\{method="GET",route="\/jobs\/:id"\} 2/);
  assert.match(text, /interview_metrics_collection_errors_total\{collector="operational_db"\} 1/);
});

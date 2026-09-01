const baseUrl = process.env.LOAD_TEST_URL?.trim();
if (!baseUrl) {
  console.error("LOAD_TEST_URL is required, e.g. http://127.0.0.1:3001");
  process.exit(2);
}

const paths = (process.env.LOAD_TEST_PATHS ?? "/health,/health/ready")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
if (!paths.length) throw new Error("LOAD_TEST_PATHS must contain at least one path");

const concurrency = Math.max(1, Math.min(200, Number(process.env.LOAD_TEST_CONCURRENCY ?? 20)));
const requestCount = Math.max(1, Math.min(100_000, Number(process.env.LOAD_TEST_REQUESTS ?? 500)));
const timeoutMs = Math.max(100, Number(process.env.LOAD_TEST_TIMEOUT_MS ?? 5_000));
const p95MaxMs = Math.max(1, Number(process.env.LOAD_TEST_P95_MAX_MS ?? 750));
const maxErrorRate = Math.max(0, Math.min(1, Number(process.env.LOAD_TEST_MAX_ERROR_RATE ?? 0.01)));
const expectedStatus = Number(process.env.LOAD_TEST_EXPECTED_STATUS ?? 200);

let headers = {};
if (process.env.LOAD_TEST_HEADERS_JSON) {
  const parsed = JSON.parse(process.env.LOAD_TEST_HEADERS_JSON);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("LOAD_TEST_HEADERS_JSON must be a JSON object");
  }
  headers = Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value)]));
}

const latencies = [];
const statusCounts = new Map();
let failures = 0;
let cursor = 0;
const startedAt = performance.now();

async function worker() {
  while (true) {
    const index = cursor++;
    if (index >= requestCount) return;
    const path = paths[index % paths.length];
    const url = new URL(path, baseUrl);
    const start = performance.now();
    try {
      const response = await fetch(url, {
        method: "GET",
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
      const latency = performance.now() - start;
      latencies.push(latency);
      statusCounts.set(response.status, (statusCounts.get(response.status) ?? 0) + 1);
      if (response.status !== expectedStatus) failures += 1;
      await response.arrayBuffer();
    } catch {
      latencies.push(performance.now() - start);
      failures += 1;
      statusCounts.set("network_error", (statusCounts.get("network_error") ?? 0) + 1);
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));
const elapsedMs = performance.now() - startedAt;
latencies.sort((a, b) => a - b);

function percentile(value) {
  if (!latencies.length) return 0;
  const index = Math.min(latencies.length - 1, Math.ceil(value * latencies.length) - 1);
  return latencies[index];
}

const p50 = percentile(0.5);
const p95 = percentile(0.95);
const p99 = percentile(0.99);
const errorRate = failures / requestCount;
const rps = requestCount / Math.max(elapsedMs / 1000, 0.001);

console.log(JSON.stringify({
  baseUrl,
  paths,
  requests: requestCount,
  concurrency,
  elapsedMs: Math.round(elapsedMs),
  requestsPerSecond: Number(rps.toFixed(2)),
  latencyMs: {
    p50: Number(p50.toFixed(2)),
    p95: Number(p95.toFixed(2)),
    p99: Number(p99.toFixed(2)),
    max: Number((latencies.at(-1) ?? 0).toFixed(2)),
  },
  failures,
  errorRate: Number(errorRate.toFixed(4)),
  statusCounts: Object.fromEntries(statusCounts),
  thresholds: { p95MaxMs, maxErrorRate, expectedStatus },
}, null, 2));

if (p95 > p95MaxMs || errorRate > maxErrorRate) {
  console.error(
    `Load test failed: p95=${p95.toFixed(2)}ms (max ${p95MaxMs}ms), errorRate=${(errorRate * 100).toFixed(2)}% (max ${(maxErrorRate * 100).toFixed(2)}%)`,
  );
  process.exitCode = 1;
} else {
  console.log("✓ load-test thresholds satisfied");
}

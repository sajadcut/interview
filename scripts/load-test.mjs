import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  booleanEnvironment,
  collectResponseCookies,
  integerEnvironment,
  scenarioThresholdFailures,
  summarizeLatencies,
} from "./load-test-lib.mjs";

const READ_FIXTURE_JOB_ID = "90909090-9090-4090-8090-909090909090";
const WRITE_JOB_PREFIX = "Load Test Write Job ";

const PROFILES = {
  public: {
    "api-health": { requests: 200, concurrency: 20, p95MaxMs: 150 },
    "db-readiness": { requests: 200, concurrency: 15, p95MaxMs: 250 },
  },
  smoke: {
    "api-health": { requests: 150, concurrency: 15, p95MaxMs: 150 },
    "db-readiness": { requests: 150, concurrency: 12, p95MaxMs: 300 },
    "auth-session": { requests: 120, concurrency: 10, p95MaxMs: 350 },
    "jobs-aggregate": { requests: 100, concurrency: 8, p95MaxMs: 700 },
    "job-workspace": { requests: 100, concurrency: 8, p95MaxMs: 600 },
    "candidate-workspace": { requests: 100, concurrency: 8, p95MaxMs: 600 },
    "candidate-list-heavy": { requests: 30, concurrency: 4, p95MaxMs: 1600 },
    "audited-write": { requests: 40, concurrency: 4, p95MaxMs: 1000 },
  },
  ci: {
    "api-health": { requests: 300, concurrency: 30, p95MaxMs: 150 },
    "db-readiness": { requests: 300, concurrency: 20, p95MaxMs: 300 },
    "auth-session": { requests: 250, concurrency: 20, p95MaxMs: 400 },
    "jobs-aggregate": { requests: 200, concurrency: 15, p95MaxMs: 800 },
    "job-workspace": { requests: 220, concurrency: 18, p95MaxMs: 700 },
    "candidate-workspace": { requests: 220, concurrency: 18, p95MaxMs: 700 },
    "candidate-list-heavy": { requests: 60, concurrency: 6, p95MaxMs: 1800 },
    "audited-write": { requests: 120, concurrency: 8, p95MaxMs: 1200 },
  },
  capacity: {
    "api-health": { requests: 1000, concurrency: 80, p95MaxMs: 200 },
    "db-readiness": { requests: 1000, concurrency: 60, p95MaxMs: 450 },
    "auth-session": { requests: 800, concurrency: 50, p95MaxMs: 600 },
    "jobs-aggregate": { requests: 600, concurrency: 40, p95MaxMs: 1200 },
    "job-workspace": { requests: 700, concurrency: 50, p95MaxMs: 1000 },
    "candidate-workspace": { requests: 700, concurrency: 50, p95MaxMs: 1000 },
    "candidate-list-heavy": { requests: 180, concurrency: 12, p95MaxMs: 2500 },
    "audited-write": { requests: 400, concurrency: 24, p95MaxMs: 1800 },
  },
};

const baseUrl = process.env.LOAD_TEST_URL?.trim();
if (!baseUrl) {
  console.error("LOAD_TEST_URL is required, e.g. http://127.0.0.1:4000");
  process.exit(2);
}
const profileName = process.env.LOAD_TEST_PROFILE?.trim() || "smoke";
const profile = PROFILES[profileName];
if (!profile) {
  console.error(`LOAD_TEST_PROFILE must be one of ${Object.keys(PROFILES).join(", ")}`);
  process.exit(2);
}

const timeoutMs = integerEnvironment(process.env.LOAD_TEST_TIMEOUT_MS, 8_000, 250, 60_000);
const maxErrorRate = Math.max(0, Math.min(1, Number(process.env.LOAD_TEST_MAX_ERROR_RATE ?? 0.01)));
const enableWrites = booleanEnvironment(process.env.LOAD_TEST_ENABLE_WRITES, profileName !== "public");
const reportPath = process.env.LOAD_TEST_REPORT?.trim();
const origin = process.env.LOAD_TEST_ORIGIN?.trim() || "http://127.0.0.1:3000";
const runId = randomUUID();
const startedAt = new Date();

const email = process.env.LOAD_TEST_USER_EMAIL?.trim()
  || process.env.E2E_USER_EMAIL?.trim()
  || process.env.DEV_USER_EMAIL?.trim();
const password = process.env.LOAD_TEST_USER_PASSWORD
  || process.env.E2E_USER_PASSWORD
  || process.env.DEV_USER_PASSWORD;

function absoluteUrl(path) {
  return new URL(path, baseUrl).toString();
}

async function readResponseBody(response) {
  const body = await response.arrayBuffer();
  return { bytes: body.byteLength, body };
}

async function jsonRequest(path, init = {}) {
  const response = await fetch(absoluteUrl(path), {
    ...init,
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return { response, parsed, text };
}

let auth = null;
if (profileName !== "public") {
  if (!email || !password) {
    console.error("LOAD_TEST_USER_EMAIL and LOAD_TEST_USER_PASSWORD are required for authenticated profiles");
    process.exit(2);
  }

  const login = await jsonRequest("/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      "x-request-id": `load:${runId}:login`,
    },
    body: JSON.stringify({ email, password }),
  });
  if (login.response.status !== 200 || !login.parsed) {
    console.error(`Load-test login failed with HTTP ${login.response.status}`);
    process.exit(1);
  }
  const cookie = collectResponseCookies(login.response.headers);
  const organizations = Array.isArray(login.parsed.organizations) ? login.parsed.organizations : [];
  const organizationId = process.env.LOAD_TEST_ORGANIZATION_ID?.trim() || organizations[0]?.id;
  if (!cookie || !organizationId) {
    console.error("Load-test login did not return a usable session cookie and organization");
    process.exit(1);
  }
  auth = { cookie, organizationId: String(organizationId) };
}

function authHeaders(extra = {}) {
  if (!auth) return extra;
  return {
    cookie: auth.cookie,
    "x-organization-id": auth.organizationId,
    origin,
    ...extra,
  };
}

let candidateId = null;
let writeJobIds = [];
if (auth) {
  const jobs = await jsonRequest("/v1/jobs", { headers: authHeaders() });
  if (jobs.response.status !== 200 || !Array.isArray(jobs.parsed)) {
    console.error(`Load-test fixture discovery failed on /v1/jobs with HTTP ${jobs.response.status}`);
    process.exit(1);
  }
  writeJobIds = jobs.parsed
    .filter((job) => typeof job?.title === "string" && job.title.startsWith(WRITE_JOB_PREFIX))
    .map((job) => String(job.id));

  const candidates = await jsonRequest(`/v1/candidates?jobId=${READ_FIXTURE_JOB_ID}`, {
    headers: authHeaders(),
  });
  if (candidates.response.status !== 200 || !Array.isArray(candidates.parsed) || !candidates.parsed.length) {
    console.error("Load-test candidate fixtures are missing. Run npm run load:test:seed first.");
    process.exit(1);
  }
  candidateId = String(candidates.parsed[0].id);

  if (enableWrites && !writeJobIds.length) {
    console.error("Audited write fixtures are missing. Run npm run load:test:seed first.");
    process.exit(1);
  }
}

function scenarioRequest(name, index) {
  const requestId = `load:${runId}:${name}:${index}`;
  switch (name) {
    case "api-health":
      return { path: "/health", init: { headers: { "x-request-id": requestId } }, expectedStatus: 200 };
    case "db-readiness":
      return { path: "/health/ready", init: { headers: { "x-request-id": requestId } }, expectedStatus: 200 };
    case "auth-session":
      return { path: "/auth/session", init: { headers: authHeaders({ "x-request-id": requestId }) }, expectedStatus: 200 };
    case "jobs-aggregate":
      return { path: "/v1/jobs", init: { headers: authHeaders({ "x-request-id": requestId }) }, expectedStatus: 200 };
    case "job-workspace":
      return {
        path: `/v1/jobs/${READ_FIXTURE_JOB_ID}/workspace`,
        init: { headers: authHeaders({ "x-request-id": requestId }) },
        expectedStatus: 200,
      };
    case "candidate-workspace":
      return {
        path: `/v1/candidates/${candidateId}/workspace`,
        init: { headers: authHeaders({ "x-request-id": requestId }) },
        expectedStatus: 200,
      };
    case "candidate-list-heavy":
      return {
        path: `/v1/candidates?jobId=${READ_FIXTURE_JOB_ID}`,
        init: { headers: authHeaders({ "x-request-id": requestId }) },
        expectedStatus: 200,
      };
    case "audited-write": {
      const jobId = writeJobIds[index % writeJobIds.length];
      return {
        path: `/v1/jobs/${jobId}`,
        init: {
          method: "PATCH",
          headers: authHeaders({
            "content-type": "application/json",
            "x-request-id": requestId,
          }),
          body: JSON.stringify({ summary: `load-test-run=${runId}; request=${index}` }),
        },
        expectedStatus: 200,
      };
    }
    default:
      throw new Error(`Unknown load-test scenario: ${name}`);
  }
}

async function runScenario(name, config) {
  const requestCount = integerEnvironment(
    process.env[`LOAD_TEST_${name.toUpperCase().replaceAll("-", "_")}_REQUESTS`],
    config.requests,
    1,
    100_000,
  );
  const concurrency = integerEnvironment(
    process.env[`LOAD_TEST_${name.toUpperCase().replaceAll("-", "_")}_CONCURRENCY`],
    config.concurrency,
    1,
    250,
  );
  const p95MaxMs = integerEnvironment(
    process.env[`LOAD_TEST_${name.toUpperCase().replaceAll("-", "_")}_P95_MAX_MS`],
    config.p95MaxMs,
    1,
    60_000,
  );
  const latencies = [];
  const statusCounts = new Map();
  let failures = 0;
  let responseBytes = 0;
  let cursor = 0;
  const scenarioStarted = performance.now();

  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= requestCount) return;
      const request = scenarioRequest(name, index);
      const start = performance.now();
      try {
        const response = await fetch(absoluteUrl(request.path), {
          ...request.init,
          cache: "no-store",
          redirect: "manual",
          signal: AbortSignal.timeout(timeoutMs),
        });
        const { bytes } = await readResponseBody(response);
        responseBytes += bytes;
        latencies.push(performance.now() - start);
        statusCounts.set(response.status, (statusCounts.get(response.status) ?? 0) + 1);
        if (response.status !== request.expectedStatus) failures += 1;
      } catch {
        latencies.push(performance.now() - start);
        failures += 1;
        statusCounts.set("network_error", (statusCounts.get("network_error") ?? 0) + 1);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const elapsedMs = performance.now() - scenarioStarted;
  const latencyMs = summarizeLatencies(latencies);
  const result = {
    name,
    requests: requestCount,
    concurrency,
    elapsedMs: Math.round(elapsedMs),
    requestsPerSecond: Number((requestCount / Math.max(elapsedMs / 1000, 0.001)).toFixed(2)),
    responseMiB: Number((responseBytes / 1024 / 1024).toFixed(2)),
    latencyMs,
    failures,
    errorRate: Number((failures / requestCount).toFixed(5)),
    statusCounts: Object.fromEntries(statusCounts),
    thresholds: { p95MaxMs, maxErrorRate },
  };
  result.thresholdFailures = scenarioThresholdFailures(result, result.thresholds);
  result.passed = result.thresholdFailures.length === 0;
  console.log(
    `${result.passed ? "✓" : "✗"} ${name}: ${result.requestsPerSecond} req/s, p95=${result.latencyMs.p95}ms, errors=${(result.errorRate * 100).toFixed(2)}%`,
  );
  return result;
}

const results = [];
for (const [name, config] of Object.entries(profile)) {
  if (name === "audited-write" && !enableWrites) continue;
  results.push(await runScenario(name, config));
}

const endedAt = new Date();
const totalRequests = results.reduce((sum, result) => sum + result.requests, 0);
const totalElapsedMs = results.reduce((sum, result) => sum + result.elapsedMs, 0);
const totalFailures = results.reduce((sum, result) => sum + result.failures, 0);
const report = {
  contractVersion: "api-load-test.v1",
  runId,
  profile: profileName,
  scope: ["api", "postgres"],
  realtimeMedia: "deferred_until_livekit",
  baseUrl,
  writesEnabled: enableWrites,
  startedAt: startedAt.toISOString(),
  endedAt: endedAt.toISOString(),
  totalRequests,
  totalFailures,
  aggregateRequestsPerSecond: Number((totalRequests / Math.max(totalElapsedMs / 1000, 0.001)).toFixed(2)),
  passed: results.every((result) => result.passed),
  scenarios: results,
  interpretation: "This measures the tested API/PostgreSQL topology. It is not a production capacity claim and excludes realtime audio/media transport.",
};

console.log(JSON.stringify(report, null, 2));
if (reportPath) {
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Load-test report written to ${reportPath}`);
}
if (!report.passed) process.exitCode = 1;

import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, test } from "node:test";
import type { AtsConnectionService } from "./ats-connection.service";
import { AtsProviderError, atsFetch } from "./ats-http";
import type { AtsConnection } from "./ats-provider.contracts";
import { GreenhouseAtsProvider } from "./greenhouse-ats.provider";
import { LeverAtsProvider } from "./lever-ats.provider";

const closers: Array<() => Promise<void>> = [];
const originalGreenhouseBase = process.env.GREENHOUSE_ATS_API_BASE_URL;
const originalGreenhouseToken = process.env.GREENHOUSE_ATS_TOKEN_URL;
const originalLeverBase = process.env.LEVER_ATS_API_BASE_URL;

afterEach(async () => {
  while (closers.length) await closers.pop()?.();
  process.env.GREENHOUSE_ATS_API_BASE_URL = originalGreenhouseBase;
  process.env.GREENHOUSE_ATS_TOKEN_URL = originalGreenhouseToken;
  process.env.LEVER_ATS_API_BASE_URL = originalLeverBase;
});

async function listen(
  handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>,
): Promise<string> {
  const server = createServer((request, response) => void handler(request, response));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}

async function bodyOf(request: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of request) body += String(chunk);
  return body;
}

function connection(providerKey: "greenhouse" | "lever"): AtsConnection {
  return {
    id: `${providerKey}-connection`,
    organizationId: "00000000-0000-0000-0000-000000000001",
    providerKey,
    credentialReference: `env://${providerKey.toUpperCase()}_TEST`,
    config: {},
    status: "configured",
  };
}

function fakeConnections(): AtsConnectionService {
  const greenhouseConnection = connection("greenhouse");
  const leverConnection = connection("lever");
  return {
    find: async (_organizationId: string, provider: "greenhouse" | "lever") => provider === "greenhouse" ? greenhouseConnection : leverConnection,
    require: async (_organizationId: string, provider: "greenhouse" | "lever") => provider === "greenhouse" ? greenhouseConnection : leverConnection,
    greenhouse: () => ({ clientId: "gh-client", clientSecret: "gh-secret" }),
    lever: () => ({ apiKey: "lever-secret", performAs: "lever-user" }),
  } as unknown as AtsConnectionService;
}

test("Greenhouse uses OAuth client credentials and the Harvest v3 candidate email filter", async () => {
  let basic = "";
  let bearer = "";
  let candidateQuery = "";
  const base = await listen(async (request, response) => {
    if (request.url === "/token") {
      basic = String(request.headers.authorization ?? "");
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ access_token: "greenhouse-token", expires_in: 3600 }));
      return;
    }
    bearer = String(request.headers.authorization ?? "");
    candidateQuery = String(request.url ?? "");
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify([{
      id: 42,
      first_name: "Jane",
      last_name: "Doe",
      title: "Backend Engineer",
      company: "Example",
      email_addresses: [{ value: "jane@example.com" }],
      updated_at: "2026-09-04T10:00:00Z",
    }]));
  });
  process.env.GREENHOUSE_ATS_API_BASE_URL = `${base}/v3`;
  process.env.GREENHOUSE_ATS_TOKEN_URL = `${base}/token`;
  const provider = new GreenhouseAtsProvider(fakeConnections());
  const results = await provider.search({
    organizationId: connection("greenhouse").organizationId,
    jobId: "job",
    query: "jane@example.com",
    limit: 5,
  });
  assert.equal(basic, `Basic ${Buffer.from("gh-client:gh-secret").toString("base64")}`);
  assert.equal(bearer, "Bearer greenhouse-token");
  assert.match(candidateQuery, /\/v3\/candidates\?per_page=/);
  assert.match(candidateQuery, /email=jane%40example\.com/);
  assert.equal(results[0]?.displayName, "Jane Doe");
  assert.equal(results[0]?.provenance.providerKey, "greenhouse");
});

test("Greenhouse export deduplicates an existing candidate and application", async () => {
  let posts = 0;
  const base = await listen(async (request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/token") {
      response.end(JSON.stringify({ access_token: "greenhouse-token", expires_in: 3600 }));
      return;
    }
    if (request.method === "POST") posts += 1;
    if (request.url?.includes("/candidates?email=")) {
      response.end(JSON.stringify([{ id: 42, first_name: "Jane", last_name: "Doe" }]));
      return;
    }
    if (request.url?.includes("/applications?candidate_ids=42&job_ids=99")) {
      response.end(JSON.stringify([{ id: 77, candidate_id: 42, job_id: 99 }]));
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  process.env.GREENHOUSE_ATS_API_BASE_URL = `${base}/v3`;
  process.env.GREENHOUSE_ATS_TOKEN_URL = `${base}/token`;
  const provider = new GreenhouseAtsProvider(fakeConnections());
  const result = await provider.exportApplication(connection("greenhouse").organizationId, {
    applicationId: "app",
    candidateId: "candidate",
    jobId: "job",
    displayName: "Jane Doe",
    primaryEmail: "jane@example.com",
    providerJobReference: "99",
    idempotencyKey: "ats:export:test",
  });
  assert.equal(result.providerCandidateReference, "42");
  assert.equal(result.providerApplicationReference, "77");
  assert.equal(result.deduplicated, true);
  assert.equal(posts, 0);
});

test("Lever uses API-key Basic auth and searches Opportunities rather than deprecated Candidates", async () => {
  let authorization = "";
  let requested = "";
  const base = await listen((request, response) => {
    authorization = String(request.headers.authorization ?? "");
    requested = String(request.url ?? "");
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      data: [{
        id: "opp-1",
        contact: { id: "contact-1", name: "Jane Doe", emails: ["jane@example.com"], headline: "Engineer" },
        stage: { id: "stage-1", text: "Recruiter Screen" },
        createdAt: 1788516000000,
      }],
      hasNext: false,
    }));
  });
  process.env.LEVER_ATS_API_BASE_URL = base;
  const provider = new LeverAtsProvider(fakeConnections());
  const result = await provider.search({
    organizationId: connection("lever").organizationId,
    jobId: "job",
    query: "jane@example.com",
    limit: 5,
  });
  assert.equal(authorization, `Basic ${Buffer.from("lever-secret:").toString("base64")}`);
  assert.match(requested, /^\/opportunities\?/);
  assert.match(requested, /email=jane%40example\.com/);
  assert.equal(result[0]?.provenance.providerKey, "lever");
});

test("Lever export reuses an existing opportunity for the same email and posting", async () => {
  let posts = 0;
  const base = await listen((request, response) => {
    if (request.method === "POST") posts += 1;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      data: [{ id: "opp-1", contact: { id: "contact-1", emails: ["jane@example.com"] } }],
      hasNext: false,
    }));
  });
  process.env.LEVER_ATS_API_BASE_URL = base;
  const provider = new LeverAtsProvider(fakeConnections());
  const result = await provider.exportApplication(connection("lever").organizationId, {
    applicationId: "app",
    candidateId: "candidate",
    jobId: "job",
    displayName: "Jane Doe",
    primaryEmail: "jane@example.com",
    providerJobReference: "posting-1",
    idempotencyKey: "ats:export:test",
  });
  assert.equal(result.providerCandidateReference, "contact-1");
  assert.equal(result.providerApplicationReference, "opp-1");
  assert.equal(result.deduplicated, true);
  assert.equal(posts, 0);
});

test("Lever stage updates use the Opportunity stage endpoint", async () => {
  let method = "";
  let path = "";
  let body = "";
  const base = await listen(async (request, response) => {
    method = request.method ?? "";
    path = request.url ?? "";
    body = await bodyOf(request);
    response.statusCode = 200;
    response.end(JSON.stringify({ data: { id: "opp-1", stage: "stage-2" } }));
  });
  process.env.LEVER_ATS_API_BASE_URL = base;
  const provider = new LeverAtsProvider(fakeConnections());
  await provider.updateStage(connection("lever").organizationId, {
    providerApplicationReference: "opp-1",
    targetStageReference: "stage-2",
    idempotencyKey: "stage-test",
  });
  assert.equal(method, "PUT");
  assert.equal(path, "/opportunities/opp-1/stage?perform_as=lever-user");
  assert.deepEqual(JSON.parse(body), { stage: "stage-2" });
});

test("non-idempotent network failures are surfaced as outcome unknown and are not retried", async () => {
  let calls = 0;
  const server = createServer((_request, response) => {
    calls += 1;
    response.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert(address && typeof address === "object");
  await assert.rejects(
    () => atsFetch(
      "test-provider",
      `http://127.0.0.1:${address.port}/write`,
      { method: "POST", body: "{}" },
      { timeoutMs: 1_000, maxAttempts: 3, retryBaseMs: 10 },
      { idempotent: false },
    ),
    (error: unknown) => {
      assert(error instanceof AtsProviderError);
      assert.equal(error.outcomeUnknown, true);
      return true;
    },
  );
  assert.equal(calls, 1);
});

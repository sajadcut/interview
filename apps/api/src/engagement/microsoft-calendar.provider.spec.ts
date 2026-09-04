import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import { test } from "node:test";

async function bodyOf(request: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of request) body += String(chunk);
  return body;
}

test("Microsoft Calendar uses client credentials, transactionId, retry and idempotent cancellation", async () => {
  let tokenRequests = 0;
  let eventPosts = 0;
  let deletes = 0;
  let tokenBody = "";
  let eventBody: Record<string, unknown> | undefined;

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/oauth/token") {
      tokenRequests += 1;
      tokenBody = await bodyOf(request);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ access_token: "microsoft-test-token", expires_in: 3600 }));
      return;
    }

    assert.equal(request.headers.authorization, "Bearer microsoft-test-token");
    if (request.method === "POST" && url.pathname.endsWith("/events")) {
      eventPosts += 1;
      eventBody = JSON.parse(await bodyOf(request)) as Record<string, unknown>;
      if (eventPosts === 1) {
        response.statusCode = 429;
        response.setHeader("retry-after", "0");
        response.end("rate limited");
        return;
      }
      response.statusCode = 201;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ id: "AAMk-test-event-id" }));
      return;
    }

    if (request.method === "DELETE" && url.pathname.endsWith("/AAMk-test-event-id")) {
      deletes += 1;
      response.statusCode = 404;
      response.end();
      return;
    }

    response.statusCode = 404;
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert(address && typeof address === "object");
    const origin = `http://127.0.0.1:${address.port}`;
    process.env.CALENDAR_PROVIDER = "microsoft";
    process.env.CALENDAR_TIMEOUT_MS = "2000";
    process.env.CALENDAR_MAX_ATTEMPTS = "2";
    process.env.CALENDAR_RETRY_BASE_MS = "50";
    process.env.MICROSOFT_CALENDAR_TENANT_ID = "tenant-id";
    process.env.MICROSOFT_CALENDAR_CLIENT_ID = "client-id";
    process.env.MICROSOFT_CALENDAR_CLIENT_SECRET = "client-secret";
    process.env.MICROSOFT_CALENDAR_USER_ID = "recruiter@example.com";
    process.env.MICROSOFT_CALENDAR_ID = "calendar-id";
    process.env.MICROSOFT_CALENDAR_TOKEN_URL = `${origin}/oauth/token`;
    process.env.MICROSOFT_CALENDAR_GRAPH_BASE_URL = `${origin}/v1.0`;
    process.env.MICROSOFT_CALENDAR_CREATE_TEAMS_MEETING = "true";

    const { MicrosoftCalendarProvider } = await import("./calendar.providers");
    const provider = new MicrosoftCalendarProvider();
    const result = await provider.reserve({
      organizationId: "00000000-0000-0000-0000-000000000001",
      schedulingRequestId: "00000000-0000-0000-0000-000000000002",
      startsAt: "2026-09-10T10:00:00.000Z",
      endsAt: "2026-09-10T11:00:00.000Z",
      timezone: "Europe/Berlin",
      title: "Technical interview",
      attendeeEmails: ["candidate@example.com"],
      idempotencyKey: "calendar:test:microsoft:1",
    });
    await provider.cancel(result.providerReference, "calendar:cancel:microsoft:1");

    assert.equal(provider.configured, true);
    assert.equal(result.provider, "microsoft");
    assert.equal(result.providerReference, "AAMk-test-event-id");
    assert.equal(tokenRequests, 1);
    assert.equal(eventPosts, 2);
    assert.equal(deletes, 1);

    const token = new URLSearchParams(tokenBody);
    assert.equal(token.get("client_id"), "client-id");
    assert.equal(token.get("client_secret"), "client-secret");
    assert.equal(token.get("scope"), "https://graph.microsoft.com/.default");
    assert.equal(token.get("grant_type"), "client_credentials");

    assert(eventBody);
    assert.equal(eventBody.subject, "Technical interview");
    assert.match(String(eventBody.transactionId), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.equal(eventBody.isOnlineMeeting, true);
    assert.equal(eventBody.onlineMeetingProvider, "teamsForBusiness");
    assert.match(JSON.stringify(eventBody), /candidate@example\.com/);
    assert.match(JSON.stringify(eventBody), /"timeZone":"UTC"/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

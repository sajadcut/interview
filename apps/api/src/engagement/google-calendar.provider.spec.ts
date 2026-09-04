import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import { test } from "node:test";

async function bodyOf(request: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of request) body += String(chunk);
  return body;
}

test("Google Calendar uses service-account OAuth, retries, deterministic event ids and idempotent lookup", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  let tokenRequests = 0;
  let eventPosts = 0;
  let eventGets = 0;
  let deletes = 0;
  let firstEventBody: Record<string, unknown> | undefined;
  let eventId = "";

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/token") {
      tokenRequests += 1;
      const body = new URLSearchParams(await bodyOf(request));
      assert.equal(body.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
      assert.equal(body.get("assertion")?.split(".").length, 3);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ access_token: "google-test-token", expires_in: 3600 }));
      return;
    }

    assert.equal(request.headers.authorization, "Bearer google-test-token");
    if (request.method === "POST" && url.pathname.endsWith("/events")) {
      eventPosts += 1;
      const parsed = JSON.parse(await bodyOf(request)) as Record<string, unknown>;
      eventId = String(parsed.id);
      firstEventBody ??= parsed;
      assert.equal(url.searchParams.get("sendUpdates"), "all");
      if (eventPosts === 1) {
        response.statusCode = 429;
        response.setHeader("retry-after", "0");
        response.end("rate limited");
        return;
      }
      if (eventPosts === 3) {
        response.statusCode = 409;
        response.end("already exists");
        return;
      }
      response.statusCode = 200;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ id: eventId }));
      return;
    }

    if (request.method === "GET" && url.pathname.endsWith(`/${eventId}`)) {
      eventGets += 1;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ id: eventId }));
      return;
    }

    if (request.method === "DELETE" && url.pathname.endsWith(`/${eventId}`)) {
      deletes += 1;
      response.statusCode = 204;
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
    process.env.CALENDAR_PROVIDER = "google";
    process.env.CALENDAR_TIMEOUT_MS = "2000";
    process.env.CALENDAR_MAX_ATTEMPTS = "2";
    process.env.CALENDAR_RETRY_BASE_MS = "50";
    process.env.GOOGLE_CALENDAR_ID = "recruiting@example.com";
    process.env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL = "calendar-bot@example.iam.gserviceaccount.com";
    process.env.GOOGLE_CALENDAR_PRIVATE_KEY = pem;
    process.env.GOOGLE_CALENDAR_TOKEN_URL = `${origin}/token`;
    process.env.GOOGLE_CALENDAR_API_BASE_URL = `${origin}/calendar/v3`;
    process.env.GOOGLE_CALENDAR_SEND_UPDATES = "all";
    process.env.GOOGLE_CALENDAR_CREATE_MEET = "true";

    const { GoogleCalendarProvider } = await import("./calendar.providers");
    const provider = new GoogleCalendarProvider();
    const request = {
      organizationId: "00000000-0000-0000-0000-000000000001",
      schedulingRequestId: "00000000-0000-0000-0000-000000000002",
      startsAt: "2026-09-10T10:00:00.000Z",
      endsAt: "2026-09-10T11:00:00.000Z",
      timezone: "Europe/Berlin",
      title: "Technical interview",
      attendeeEmails: ["candidate@example.com"],
      idempotencyKey: "calendar:test:google:1",
    };

    const first = await provider.reserve(request);
    const second = await provider.reserve(request);
    await provider.cancel(first.providerReference, "calendar:cancel:google:1");

    assert.equal(provider.configured, true);
    assert.equal(first.provider, "google");
    assert.equal(second.providerReference, first.providerReference);
    assert.match(first.providerReference, /^i[0-9a-f]{64}$/);
    assert.equal(tokenRequests, 1);
    assert.equal(eventPosts, 3);
    assert.equal(eventGets, 1);
    assert.equal(deletes, 1);
    assert.equal(firstEventBody?.summary, "Technical interview");
    assert.match(JSON.stringify(firstEventBody), /candidate@example\.com/);
    assert.match(JSON.stringify(firstEventBody), /hangoutsMeet/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

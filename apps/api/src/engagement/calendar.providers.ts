import { createHash, sign } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { getEnv, type AppEnv } from "../config/env";
import type {
  CalendarProvider,
  CalendarReservationRequest,
  CalendarReservationResult,
} from "./engagement-provider.contracts";

const GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const MICROSOFT_SCOPE = "https://graph.microsoft.com/.default";

export class CalendarProviderError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = "CalendarProviderError";
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableGoogleEventId(idempotencyKey: string): string {
  // Google custom event IDs accept base32hex characters; a-f/0-9 plus the i prefix are valid.
  return `i${sha256(idempotencyKey)}`;
}

function stableUuid(idempotencyKey: string): string {
  const value = sha256(idempotencyKey);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}

function normalizedPrivateKey(value: string): string {
  return value.replace(/\\n/g, "\n").trim();
}

function toBase64Url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function validateReservation(request: CalendarReservationRequest): void {
  const start = new Date(request.startsAt);
  const end = new Date(request.endsAt);
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf()) || end <= start) {
    throw new CalendarProviderError("Calendar reservation contains an invalid time range", "INVALID_TIME_RANGE", false);
  }
  if (!request.title.trim()) {
    throw new CalendarProviderError("Calendar reservation title is required", "INVALID_TITLE", false);
  }
  if (!request.attendeeEmails.length) {
    throw new CalendarProviderError("At least one attendee email is required", "MISSING_ATTENDEE", false);
  }
  for (const email of request.attendeeEmails) {
    if (!/^\S+@\S+\.\S+$/.test(email) || /[\r\n]/.test(email)) {
      throw new CalendarProviderError("Calendar attendee email is invalid", "INVALID_ATTENDEE", false);
    }
  }
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function retryAfterMs(response: Response): number | null {
  const raw = response.headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 30_000);
  const date = new Date(raw);
  if (Number.isNaN(date.valueOf())) return null;
  return Math.min(Math.max(date.valueOf() - Date.now(), 0), 30_000);
}

async function pause(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function responseFailure(response: Response, provider: string): Promise<CalendarProviderError> {
  const body = (await response.text()).slice(0, 800).replace(/\s+/g, " ").trim();
  return new CalendarProviderError(
    `${provider} calendar request failed with HTTP ${response.status}${body ? `: ${body}` : ""}`,
    `${provider.toUpperCase()}_HTTP_${response.status}`,
    retryableStatus(response.status),
    response.status,
  );
}

async function fetchWithRetry(
  env: AppEnv,
  provider: string,
  url: string,
  init: RequestInit,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= env.CALENDAR_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(env.CALENDAR_TIMEOUT_MS),
      });
      if (response.ok || !retryableStatus(response.status) || attempt === env.CALENDAR_MAX_ATTEMPTS) {
        return response;
      }
      await pause(retryAfterMs(response) ?? Math.min(env.CALENDAR_RETRY_BASE_MS * 2 ** (attempt - 1), 5_000));
    } catch (error) {
      lastError = error;
      if (attempt === env.CALENDAR_MAX_ATTEMPTS) break;
      await pause(Math.min(env.CALENDAR_RETRY_BASE_MS * 2 ** (attempt - 1), 5_000));
    }
  }
  throw new CalendarProviderError(
    `${provider} calendar request failed before a response was received`,
    `${provider.toUpperCase()}_NETWORK_ERROR`,
    true,
    undefined,
  , { cause: lastError } as never);
}

interface AccessTokenCache {
  token: string;
  expiresAt: number;
}

@Injectable()
export class GoogleCalendarProvider implements CalendarProvider {
  readonly providerKey = "google";
  readonly configured: boolean;
  private readonly env = getEnv();
  private tokenCache?: AccessTokenCache;

  constructor() {
    this.configured = this.env.CALENDAR_PROVIDER === "google";
  }

  private async accessToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 30_000) return this.tokenCache.token;

    const now = Math.floor(Date.now() / 1_000);
    const tokenUrl = this.env.GOOGLE_CALENDAR_TOKEN_URL ?? "https://oauth2.googleapis.com/token";
    const header = toBase64Url({ alg: "RS256", typ: "JWT" });
    const payload = toBase64Url({
      iss: this.env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL,
      scope: GOOGLE_SCOPE,
      aud: tokenUrl,
      iat: now,
      exp: now + 3_600,
      ...(this.env.GOOGLE_CALENDAR_DELEGATED_SUBJECT
        ? { sub: this.env.GOOGLE_CALENDAR_DELEGATED_SUBJECT }
        : {}),
    });
    const unsigned = `${header}.${payload}`;
    let signature: string;
    try {
      signature = sign("RSA-SHA256", Buffer.from(unsigned), normalizedPrivateKey(this.env.GOOGLE_CALENDAR_PRIVATE_KEY)).toString("base64url");
    } catch (error) {
      throw new CalendarProviderError("Google Calendar private key could not sign an OAuth assertion", "GOOGLE_INVALID_PRIVATE_KEY", false, undefined, { cause: error } as never);
    }

    const response = await fetchWithRetry(this.env, "google-auth", tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${unsigned}.${signature}`,
      }),
    });
    if (!response.ok) throw await responseFailure(response, "google-auth");
    const body = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) {
      throw new CalendarProviderError("Google OAuth response did not contain an access token", "GOOGLE_TOKEN_RESPONSE_INVALID", false);
    }
    this.tokenCache = {
      token: body.access_token,
      expiresAt: Date.now() + Math.max((body.expires_in ?? 3_600) - 30, 30) * 1_000,
    };
    return body.access_token;
  }

  private eventUrl(eventId?: string): string {
    const base = this.env.GOOGLE_CALENDAR_API_BASE_URL ?? "https://www.googleapis.com/calendar/v3";
    const calendar = encodeURIComponent(this.env.GOOGLE_CALENDAR_ID);
    return `${base.replace(/\/$/, "")}/calendars/${calendar}/events${eventId ? `/${encodeURIComponent(eventId)}` : ""}`;
  }

  async reserve(request: CalendarReservationRequest): Promise<CalendarReservationResult> {
    validateReservation(request);
    const token = await this.accessToken();
    const eventId = stableGoogleEventId(request.idempotencyKey);
    const params = new URLSearchParams({ sendUpdates: this.env.GOOGLE_CALENDAR_SEND_UPDATES });
    if (this.env.GOOGLE_CALENDAR_CREATE_MEET) params.set("conferenceDataVersion", "1");
    const marker = sha256(request.idempotencyKey).slice(0, 32);
    const body = {
      id: eventId,
      summary: request.title.trim(),
      description: `Interview scheduling reference: ${marker}`,
      start: { dateTime: new Date(request.startsAt).toISOString(), timeZone: request.timezone },
      end: { dateTime: new Date(request.endsAt).toISOString(), timeZone: request.timezone },
      attendees: request.attendeeEmails.map((email) => ({ email })),
      extendedProperties: { private: { interviewSchedulingKey: marker } },
      ...(this.env.GOOGLE_CALENDAR_CREATE_MEET
        ? { conferenceData: { createRequest: { requestId: marker, conferenceSolutionKey: { type: "hangoutsMeet" } } } }
        : {}),
    };
    const response = await fetchWithRetry(this.env, "google", `${this.eventUrl()}?${params}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    if (response.status === 409) {
      const existing = await fetchWithRetry(this.env, "google", this.eventUrl(eventId), {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!existing.ok) throw await responseFailure(existing, "google");
      const event = (await existing.json()) as { id?: string };
      return {
        provider: this.providerKey,
        providerReference: event.id ?? eventId,
        startsAt: request.startsAt,
        endsAt: request.endsAt,
      };
    }
    if (!response.ok) throw await responseFailure(response, "google");
    const event = (await response.json()) as { id?: string };
    if (!event.id) throw new CalendarProviderError("Google Calendar response did not contain an event id", "GOOGLE_EVENT_RESPONSE_INVALID", false);
    return { provider: this.providerKey, providerReference: event.id, startsAt: request.startsAt, endsAt: request.endsAt };
  }

  async cancel(providerReference: string, idempotencyKey: string): Promise<void> {
    void idempotencyKey;
    const token = await this.accessToken();
    const response = await fetchWithRetry(
      this.env,
      "google",
      `${this.eventUrl(providerReference)}?sendUpdates=${encodeURIComponent(this.env.GOOGLE_CALENDAR_SEND_UPDATES)}`,
      { method: "DELETE", headers: { authorization: `Bearer ${token}` } },
    );
    if (response.ok || response.status === 404 || response.status === 410) return;
    throw await responseFailure(response, "google");
  }
}

@Injectable()
export class MicrosoftCalendarProvider implements CalendarProvider {
  readonly providerKey = "microsoft";
  readonly configured: boolean;
  private readonly env = getEnv();
  private tokenCache?: AccessTokenCache;

  constructor() {
    this.configured = this.env.CALENDAR_PROVIDER === "microsoft";
  }

  private tokenUrl(): string {
    return this.env.MICROSOFT_CALENDAR_TOKEN_URL
      ?? `https://login.microsoftonline.com/${encodeURIComponent(this.env.MICROSOFT_CALENDAR_TENANT_ID)}/oauth2/v2.0/token`;
  }

  private async accessToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 30_000) return this.tokenCache.token;
    const response = await fetchWithRetry(this.env, "microsoft-auth", this.tokenUrl(), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.env.MICROSOFT_CALENDAR_CLIENT_ID,
        client_secret: this.env.MICROSOFT_CALENDAR_CLIENT_SECRET,
        scope: MICROSOFT_SCOPE,
        grant_type: "client_credentials",
      }),
    });
    if (!response.ok) throw await responseFailure(response, "microsoft-auth");
    const body = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) {
      throw new CalendarProviderError("Microsoft OAuth response did not contain an access token", "MICROSOFT_TOKEN_RESPONSE_INVALID", false);
    }
    this.tokenCache = {
      token: body.access_token,
      expiresAt: Date.now() + Math.max((body.expires_in ?? 3_600) - 30, 30) * 1_000,
    };
    return body.access_token;
  }

  private eventsUrl(providerReference?: string): string {
    const base = (this.env.MICROSOFT_CALENDAR_GRAPH_BASE_URL ?? "https://graph.microsoft.com/v1.0").replace(/\/$/, "");
    const user = encodeURIComponent(this.env.MICROSOFT_CALENDAR_USER_ID);
    const calendar = this.env.MICROSOFT_CALENDAR_ID
      ? `/calendars/${encodeURIComponent(this.env.MICROSOFT_CALENDAR_ID)}`
      : "/calendar";
    return `${base}/users/${user}${calendar}/events${providerReference ? `/${encodeURIComponent(providerReference)}` : ""}`;
  }

  async reserve(request: CalendarReservationRequest): Promise<CalendarReservationResult> {
    validateReservation(request);
    const token = await this.accessToken();
    const marker = sha256(request.idempotencyKey).slice(0, 32);
    const toUtc = (value: string) => new Date(value).toISOString().replace(/Z$/, "");
    const body = {
      subject: request.title.trim(),
      body: { contentType: "text", content: `Interview scheduling reference: ${marker}` },
      start: { dateTime: toUtc(request.startsAt), timeZone: "UTC" },
      end: { dateTime: toUtc(request.endsAt), timeZone: "UTC" },
      attendees: request.attendeeEmails.map((email) => ({
        emailAddress: { address: email },
        type: "required",
      })),
      transactionId: stableUuid(request.idempotencyKey),
      allowNewTimeProposals: false,
      ...(this.env.MICROSOFT_CALENDAR_CREATE_TEAMS_MEETING
        ? { isOnlineMeeting: true, onlineMeetingProvider: "teamsForBusiness" }
        : {}),
    };
    const response = await fetchWithRetry(this.env, "microsoft", this.eventsUrl(), {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw await responseFailure(response, "microsoft");
    const event = (await response.json()) as { id?: string };
    if (!event.id) throw new CalendarProviderError("Microsoft Calendar response did not contain an event id", "MICROSOFT_EVENT_RESPONSE_INVALID", false);
    return { provider: this.providerKey, providerReference: event.id, startsAt: request.startsAt, endsAt: request.endsAt };
  }

  async cancel(providerReference: string, idempotencyKey: string): Promise<void> {
    void idempotencyKey;
    const token = await this.accessToken();
    const response = await fetchWithRetry(this.env, "microsoft", this.eventsUrl(providerReference), {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    if (response.ok || response.status === 404 || response.status === 410) return;
    throw await responseFailure(response, "microsoft");
  }
}

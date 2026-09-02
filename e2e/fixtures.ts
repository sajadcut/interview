import { expect, test as base, type Request, type Response } from "@playwright/test";
import { candidateIdentityForProject, type CandidateE2EIdentity } from "./support";

const genericClientErrorConsole = /^Failed to load resource: the server responded with a status of 4\d\d\b/;
const webkitNextRscPrefetchAccessControlError =
  /^\/127\.0\.0\.1:3000\/app(?:\/[^\s?]+)*\?_rsc=[^\s]+ due to access control checks\.$/;

type ExpectedBackendFailure = {
  method: string;
  path: string;
  statuses: readonly number[];
};

const expectedBackendClientFailures: readonly ExpectedBackendFailure[] = [
  { method: "POST", path: "/api/backend/auth/login", statuses: [401] },
  { method: "GET", path: "/api/backend/auth/session", statuses: [401] },
  { method: "GET", path: "/api/backend/v1/candidate-auth/session", statuses: [401] },
  { method: "GET", path: "/api/backend/v1/candidate-consent", statuses: [401] },
  { method: "POST", path: "/api/backend/v1/candidate-auth/invitations", statuses: [403] },
  { method: "POST", path: "/api/backend/v1/candidate-auth/magic-link/validate", statuses: [401] },
  { method: "POST", path: "/api/backend/v1/candidate-auth/otp/verify", statuses: [401] },
];

const navigationAbortedLogoutPaths = new Set([
  "/api/backend/auth/logout",
  "/api/backend/v1/candidate-auth/logout",
]);

function isExpectedBackendClientFailure(response: Response): boolean {
  const path = new URL(response.url()).pathname;
  const method = response.request().method();
  return expectedBackendClientFailures.some(
    (entry) => entry.method === method && entry.path === path && entry.statuses.includes(response.status()),
  );
}

function isExpectedBackendRequestFailure(request: Request): boolean {
  const path = new URL(request.url()).pathname;
  return (
    request.method() === "POST" &&
    navigationAbortedLogoutPaths.has(path) &&
    request.failure()?.errorText === "net::ERR_ABORTED"
  );
}

function isExpectedPageError(projectName: string, message: string): boolean {
  // Next.js App Router can ask WebKit to prefetch same-origin RSC payloads for links that are
  // never navigated. WebKit reports some of those cancelled/background prefetches as page errors
  // with "due to access control checks" even though the document and API requests succeeded.
  // Keep this exception deliberately narrow: WebKit compatibility project + local /app RSC prefetch only.
  return projectName === "webkit-compat" && webkitNextRscPrefetchAccessControlError.test(message);
}

type E2EFixtures = {
  candidateIdentity: CandidateE2EIdentity;
};

export const test = base.extend<E2EFixtures>({
  candidateIdentity: async ({}, use, testInfo) => {
    await use(candidateIdentityForProject(testInfo.project.name));
  },
  page: async ({ page }, use, testInfo) => {
    const diagnostics: string[] = [];

    page.on("pageerror", (error) => {
      if (isExpectedPageError(testInfo.project.name, error.message)) return;
      diagnostics.push(`pageerror: ${error.message}`);
    });
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const text = message.text();
      // Chromium's generic 4xx console line has no URL. The response listener below
      // classifies the concrete backend request against the explicit negative-flow allowlist.
      if (genericClientErrorConsole.test(text)) return;
      diagnostics.push(`console.error: ${text}`);
    });
    page.on("response", (response) => {
      if (!response.url().includes("/api/backend")) return;
      if (response.status() >= 500) {
        diagnostics.push(`backend ${response.status()}: ${response.request().method()} ${response.url()}`);
        return;
      }
      if (response.status() >= 400 && !isExpectedBackendClientFailure(response)) {
        diagnostics.push(`unexpected backend ${response.status()}: ${response.request().method()} ${response.url()}`);
      }
    });
    page.on("requestfailed", (request) => {
      if (!request.url().includes("/api/backend")) return;
      // Browser navigation can cancel the client-side fetch after logout has already invalidated
      // the cookie-backed session. Only the two explicit logout endpoints + ERR_ABORTED are allowed;
      // each corresponding E2E flow then re-opens a protected route to prove the session is gone.
      if (isExpectedBackendRequestFailure(request)) return;
      diagnostics.push(
        `backend request failed: ${request.method()} ${request.url()} (${request.failure()?.errorText ?? "unknown error"})`,
      );
    });

    await use(page);

    if (diagnostics.length > 0) {
      await testInfo.attach("browser-diagnostics.txt", {
        body: Buffer.from(diagnostics.join("\n"), "utf8"),
        contentType: "text/plain",
      });
    }
    expect(diagnostics, "unexpected browser/runtime errors").toEqual([]);
  },
});

export { expect } from "@playwright/test";

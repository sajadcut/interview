import { expect, test as base, type Response } from "@playwright/test";
import { candidateIdentityForProject, type CandidateE2EIdentity } from "./support";

const genericClientErrorConsole = /^Failed to load resource: the server responded with a status of 4\d\d\b/;

const expectedBackendClientFailures = [
  { method: "GET", path: "/api/backend/auth/session", statuses: new Set([401]) },
  { method: "GET", path: "/api/backend/v1/candidate-auth/session", statuses: new Set([401]) },
  { method: "GET", path: "/api/backend/v1/candidate-consent", statuses: new Set([401]) },
  { method: "POST", path: "/api/backend/v1/candidate-auth/magic-link/validate", statuses: new Set([401]) },
  { method: "POST", path: "/api/backend/v1/candidate-auth/otp/verify", statuses: new Set([401]) },
] as const;

function isExpectedBackendClientFailure(response: Response): boolean {
  const path = new URL(response.url()).pathname;
  const method = response.request().method();
  return expectedBackendClientFailures.some(
    (entry) => entry.method === method && entry.path === path && entry.statuses.has(response.status() as never),
  );
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

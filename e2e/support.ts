import { expect, type Page } from "@playwright/test";

export const BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";
export const E2E_USER_EMAIL = process.env.E2E_USER_EMAIL ?? "browser.e2e@local.interview";
export const E2E_USER_PASSWORD = process.env.E2E_USER_PASSWORD ?? "BrowserE2e!2026#Secure";

export const SEEDED_CANDIDATE_ID = "22222222-2222-4222-8222-222222222222";
export const SEEDED_APPLICATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

export interface CandidateInvitationSecrets {
  developmentToken: string;
  developmentOtp: string;
}

export async function signInRecruiter(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(E2E_USER_EMAIL);
  await page.getByLabel("Password").fill(E2E_USER_PASSWORD);
  await Promise.all([
    page.waitForURL(/\/app(?:\/)?$/),
    page.getByRole("button", { name: "Sign in" }).click(),
  ]);
  await expect(page.getByRole("heading", { name: "Hiring command center" })).toBeVisible();
}

export async function activeOrganizationId(page: Page): Promise<string> {
  const organizationId = await page.evaluate(() => window.localStorage.getItem("interview.organizationId"));
  expect(organizationId).toBeTruthy();
  return organizationId!;
}

export async function createCandidateInvitation(page: Page): Promise<CandidateInvitationSecrets> {
  const organizationId = await activeOrganizationId(page);
  const response = await page.context().request.post(`${BASE_URL}/api/backend/v1/candidate-auth/invitations`, {
    headers: {
      origin: BASE_URL,
      "content-type": "application/json",
      "x-organization-id": organizationId,
    },
    data: { applicationId: SEEDED_APPLICATION_ID },
  });

  const rawBody = await response.text();
  expect(
    response.ok(),
    `candidate invitation API returned ${response.status()}: ${rawBody.slice(0, 1000)}`,
  ).toBeTruthy();

  let body: Partial<CandidateInvitationSecrets>;
  try {
    body = JSON.parse(rawBody) as Partial<CandidateInvitationSecrets>;
  } catch {
    throw new Error(`candidate invitation API returned non-JSON success payload: ${rawBody.slice(0, 1000)}`);
  }
  expect(body.developmentToken).toBeTruthy();
  expect(body.developmentOtp).toMatch(/^\d{6}$/);
  return body as CandidateInvitationSecrets;
}

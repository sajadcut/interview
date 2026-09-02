import { test, expect } from "./fixtures";
import {
  E2E_USER_EMAIL,
  SEEDED_APPLICATION_ID,
  activeOrganizationId,
  signInRecruiter,
} from "./support";

const UNAUTHORIZED_ORGANIZATION_ID = "99999999-9999-4999-8999-999999999999";

test.describe("browser security boundaries", () => {
  test("invalid recruiter credentials fail closed without creating organization context", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Work email").fill(E2E_USER_EMAIL);
    await page.getByLabel("Password").fill("DefinitelyWrong!2026#Password");

    const loginResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/backend/auth/login" && response.request().method() === "POST";
    });
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(await loginResponse).toHaveProperty("status", 401);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText(/invalid email or password/i)).toBeVisible();
    await expect(page.evaluate(() => window.localStorage.getItem("interview.organizationId"))).resolves.toBeNull();
  });

  test("recruiter session cannot cross into the candidate security surface", async ({ page }) => {
    await signInRecruiter(page);

    await page.goto("/candidate/setup");
    await page.waitForURL(/\/candidate\/login$/);
    await expect(page.getByRole("heading", { name: "Open your interview invitation" })).toBeVisible();

    // Candidate auth failure must not revoke or replace the independent internal session.
    await page.goto("/app");
    await expect(page.getByRole("heading", { name: "Hiring command center" })).toBeVisible();
  });

  test("organization header tampering cannot cross tenant boundaries", async ({ page }) => {
    await signInRecruiter(page);
    const authorizedOrganizationId = await activeOrganizationId(page);
    expect(authorizedOrganizationId).not.toBe(UNAUTHORIZED_ORGANIZATION_ID);

    const result = await page.evaluate(
      async ({ applicationId, organizationId }) => {
        const response = await fetch("/api/backend/v1/candidate-auth/invitations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-organization-id": organizationId,
          },
          body: JSON.stringify({ applicationId }),
        });
        return { status: response.status, body: await response.text() };
      },
      {
        applicationId: SEEDED_APPLICATION_ID,
        organizationId: UNAUTHORIZED_ORGANIZATION_ID,
      },
    );

    expect(result.status, `cross-tenant invitation unexpectedly returned: ${result.body.slice(0, 1000)}`).toBe(403);
    await expect(page.evaluate(() => window.localStorage.getItem("interview.organizationId"))).resolves.toBe(
      authorizedOrganizationId,
    );
  });
});

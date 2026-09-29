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
    await page.getByLabel("ایمیل کاری").fill(E2E_USER_EMAIL);
    await page.getByLabel("رمز عبور").fill("DefinitelyWrong!2026#Password");

    const loginResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/backend/auth/login" && response.request().method() === "POST";
    });
    await page.getByRole("button", { name: "ورود" }).click();

    const loginResponse = await loginResponsePromise;
    expect(loginResponse.status()).toBe(401);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText("ایمیل یا رمز عبور نادرست است")).toBeVisible();
    expect(await page.evaluate(() => window.localStorage.getItem("interview.organizationId"))).toBeNull();
  });

  test("recruiter session cannot cross into the candidate security surface", async ({ page }) => {
    await signInRecruiter(page);

    await page.goto("/candidate/setup");
    await page.waitForURL(/\/candidate\/login$/);
    await expect(page.getByRole("heading", { name: "Open your interview invitation" })).toBeVisible();

    // Candidate auth failure must not revoke or replace the independent internal session.
    await page.goto("/app");
    await expect(page.getByRole("heading", { name: "مرکز فرمان جذب و استخدام" })).toBeVisible();
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
    expect(await page.evaluate(() => window.localStorage.getItem("interview.organizationId"))).toBe(
      authorizedOrganizationId,
    );
  });
});

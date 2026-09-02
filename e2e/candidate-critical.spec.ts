import { test, expect } from "./fixtures";
import { BASE_URL, createCandidateInvitation, signInRecruiter } from "./support";

async function verifyCandidateInvitation(page: Parameters<typeof signInRecruiter>[0], token: string, otp: string) {
  await page.goto(`/candidate/invitation?token=${encodeURIComponent(token)}`);
  await expect(page.getByRole("heading", { name: "Verify candidate access" })).toBeVisible();
  await expect(page.getByText("Ali Rahimi", { exact: true })).toBeVisible();
  await expect(page.getByText("Senior Backend Engineer", { exact: false })).toBeVisible();
  await page.getByLabel("One-time verification code").fill(otp);
  await Promise.all([
    page.waitForURL(/\/candidate\/setup$/),
    page.getByRole("button", { name: "Verify and continue" }).click(),
  ]);
  await expect(page.getByRole("heading", { name: "Prepare your interview" })).toBeVisible();
}

function candidateAlert(page: Parameters<typeof signInRecruiter>[0], text: RegExp | string) {
  return page.getByRole("alert").filter({ hasText: text });
}

test.describe("critical candidate flows", () => {
  test("candidate setup is protected without a candidate session", async ({ page }) => {
    await page.goto("/candidate/setup");
    await page.waitForURL(/\/candidate\/login$/);
    await expect(page.getByRole("heading", { name: "Open your interview invitation" })).toBeVisible();
  });

  test("invalid invitation fails closed in the browser", async ({ page }) => {
    await page.goto(`/candidate/invitation?token=${"x".repeat(43)}`);
    await expect(candidateAlert(page, /invalid|expired|already used/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Verify and continue" })).toHaveCount(0);
  });

  test("candidate verifies invitation, persists consent, checks devices and reaches interview gate", async ({ page, context }) => {
    await signInRecruiter(page);
    const invitation = await createCandidateInvitation(page);

    await context.clearCookies();
    await page.evaluate(() => window.localStorage.clear());
    await verifyCandidateInvitation(page, invitation.developmentToken, invitation.developmentOtp);

    await page.goto("/candidate/interview");
    await page.waitForURL(/\/candidate\/setup$/);
    await expect(page.getByRole("heading", { name: "Prepare your interview" })).toBeVisible();

    await page.getByLabel(/Privacy disclosure/).check();
    await page.getByLabel(/AI-assisted interview/).check();
    await page.getByLabel(/Audio\/video recording/).check();

    await page.getByRole("button", { name: "Check camera and microphone" }).click();
    await expect(page.getByRole("button", { name: "Check again" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue to interview" })).toBeEnabled();

    await Promise.all([
      page.waitForURL(/\/candidate\/interview$/),
      page.getByRole("button", { name: "Continue to interview" }).click(),
    ]);

    await expect(page.getByRole("heading", { name: "Your interview is ready for the Realtime stage" })).toBeVisible();
    await expect(page.getByText(/Hello Ali Rahimi/)).toBeVisible();
    await expect(page.getByRole("status")).toContainText("Network is ready.");

    await context.setOffline(true);
    await expect(candidateAlert(page, "Network connection is offline")).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByRole("status")).toContainText("Network connection restored");

    await context.clearCookies();
    await page.goto(`${BASE_URL}/candidate/invitation?token=${encodeURIComponent(invitation.developmentToken)}`);
    await expect(candidateAlert(page, /invalid|expired|already used/i)).toBeVisible();
  });
});

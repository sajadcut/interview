import { test, expect } from "./fixtures";
import { BASE_URL, createCandidateInvitation, signInRecruiter, type CandidateE2EIdentity } from "./support";

async function verifyCandidateInvitation(
  page: Parameters<typeof signInRecruiter>[0],
  identity: CandidateE2EIdentity,
  token: string,
  otp: string,
) {
  await page.goto(`/candidate/invitation?token=${encodeURIComponent(token)}`);
  await expect(page.getByRole("heading", { name: "Verify candidate access" })).toBeVisible();
  await expect(page.getByText(identity.displayName, { exact: true })).toBeVisible();
  await expect(page.getByText(identity.jobTitle, { exact: false })).toBeVisible();
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

  test("candidate verifies invitation, persists consent, recovers devices and reaches interview gate", async ({ page, context, candidateIdentity }) => {
    await signInRecruiter(page);
    const invitation = await createCandidateInvitation(page, candidateIdentity.applicationId);

    await context.clearCookies();
    await page.evaluate(() => window.localStorage.clear());
    await verifyCandidateInvitation(page, candidateIdentity, invitation.developmentToken, invitation.developmentOtp);

    // The candidate session is cookie-backed and must survive a full browser reload.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Prepare your interview" })).toBeVisible();
    await expect(page.getByText(new RegExp(candidateIdentity.displayName))).toBeVisible();

    // Interview access fails closed until persisted consent exists.
    await page.goto("/candidate/interview");
    await page.waitForURL(/\/candidate\/setup$/);
    await expect(page.getByRole("heading", { name: "Prepare your interview" })).toBeVisible();

    const continueButton = page.getByRole("button", { name: "Continue to interview" });
    await expect(continueButton).toBeDisabled();

    await page.getByLabel(/Privacy disclosure/).check();
    await page.getByLabel(/AI-assisted interview/).check();
    await page.getByLabel(/Audio\/video recording/).check();
    await expect(continueButton).toBeDisabled();

    // Exercise the candidate-facing device failure path once, then recover with Chromium's real fake media devices.
    await page.evaluate(() => {
      const mediaDevices = navigator.mediaDevices;
      const original = mediaDevices.getUserMedia.bind(mediaDevices);
      let rejectOnce = true;
      mediaDevices.getUserMedia = async (constraints: MediaStreamConstraints) => {
        if (rejectOnce) {
          rejectOnce = false;
          throw new DOMException("E2E simulated device denial", "NotAllowedError");
        }
        return original(constraints);
      };
    });

    await page.getByRole("button", { name: "Check camera and microphone" }).click();
    await expect(candidateAlert(page, "E2E simulated device denial")).toBeVisible();
    await expect(continueButton).toBeDisabled();

    await page.getByRole("button", { name: "Check camera and microphone" }).click();
    await expect(page.getByRole("button", { name: "Check again" })).toBeVisible();
    await expect(continueButton).toBeEnabled();

    await Promise.all([
      page.waitForURL(/\/candidate\/interview$/),
      continueButton.click(),
    ]);

    await expect(page.getByRole("heading", { name: "Your interview is ready for the Realtime stage" })).toBeVisible();
    await expect(page.getByText(new RegExp(`Hello ${candidateIdentity.displayName}`))).toBeVisible();
    await expect(page.getByRole("status")).toContainText("Network is ready.");

    await context.setOffline(true);
    await expect(candidateAlert(page, "Network connection is offline")).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByRole("status")).toContainText("Network connection restored");

    // Both the candidate session and consent ledger must survive reload; device readiness is intentionally per-page.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Your interview is ready for the Realtime stage" })).toBeVisible();
    await expect(page.getByText(new RegExp(`Hello ${candidateIdentity.displayName}`))).toBeVisible();

    // Invitation secrets are single-use even after the authenticated session is discarded.
    await context.clearCookies();
    await page.goto(`${BASE_URL}/candidate/invitation?token=${encodeURIComponent(invitation.developmentToken)}`);
    await expect(candidateAlert(page, /invalid|expired|already used/i)).toBeVisible();
  });
});

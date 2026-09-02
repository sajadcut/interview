import { test, expect } from "./fixtures";
import {
  BASE_URL,
  createCandidateInvitation,
  setCandidateConsents,
  signInRecruiter,
  type CandidateE2EIdentity,
} from "./support";

function candidateAlert(page: Parameters<typeof signInRecruiter>[0], text: RegExp | string) {
  return page.getByRole("alert").filter({ hasText: text });
}

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

  // A mistyped code must fail closed without consuming the invitation, allowing a valid retry.
  const wrongOtp = otp === "000000" ? "111111" : "000000";
  await page.getByLabel("One-time verification code").fill(wrongOtp);
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(candidateAlert(page, "Candidate OTP is invalid")).toBeVisible();
  await expect(page).toHaveURL(/\/candidate\/invitation\?token=/);

  await page.getByLabel("One-time verification code").fill(otp);
  await Promise.all([
    page.waitForURL(/\/candidate\/setup$/),
    page.getByRole("button", { name: "Verify and continue" }).click(),
  ]);
  await expect(page.getByRole("heading", { name: "Prepare your interview" })).toBeVisible();
}

test.describe("critical candidate flows", () => {
  test("candidate setup is protected without a candidate session", async ({ page }) => {
    await page.goto("/candidate/setup");
    await page.waitForURL(/\/candidate\/login$/);
    await expect(page.getByRole("heading", { name: "Open your interview invitation" })).toBeVisible();
  });

  test("invalid invitation fails closed in the browser", async ({ page }) => {
    await page.goto(`/candidate/invitation?token=${"x".repeat(43)}`);
    await expect(candidateAlert(page, /invalid|expired|already (?:been )?used/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Verify and continue" })).toHaveCount(0);
  });

  test("candidate can paste an invitation token from the secure login surface", async ({ page, context, candidateIdentity }) => {
    await signInRecruiter(page);
    const invitation = await createCandidateInvitation(page, candidateIdentity.applicationId);

    await context.clearCookies();
    await page.evaluate(() => window.localStorage.clear());
    await page.goto("/candidate/login");
    await page.locator("form input").fill(invitation.developmentToken);
    await Promise.all([
      page.waitForURL(/\/candidate\/invitation\?token=/),
      page.locator("form").getByRole("button").click(),
    ]);

    await expect(page.getByRole("heading", { name: "Verify candidate access" })).toBeVisible();
    await expect(page.getByText(candidateIdentity.displayName, { exact: true })).toBeVisible();
  });

  test("candidate verifies invitation, persists consent, recovers devices and reaches interview gate", async ({ page, context, candidateIdentity }) => {
    await signInRecruiter(page);
    const invitation = await createCandidateInvitation(page, candidateIdentity.applicationId);

    await context.clearCookies();
    await page.evaluate(() => window.localStorage.clear());
    await verifyCandidateInvitation(page, candidateIdentity, invitation.developmentToken, invitation.developmentOtp);

    // Consent is application/candidate state, not invitation state. Reset it after authentication so
    // CI retries and repeated local runs always exercise the pre-consent gate deterministically.
    await setCandidateConsents(page, false);

    // Candidate and internal sessions are deliberately separate security surfaces. A valid candidate
    // cookie must not grant access to the recruiter workspace, and checking that boundary must not
    // destroy the candidate session.
    await page.goto("/app");
    await expect(page.getByRole("heading", { name: "ورود سازمانی لازم است" })).toBeVisible();
    await page.goto("/candidate/setup");

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

    // Exercise the device failure path once, then recover. Even with working devices,
    // candidate consent must remain an independent gate.
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
    await expect(continueButton).toBeDisabled();

    // Each required consent is independently necessary; readiness appears only after all three.
    await page.getByLabel(/Privacy disclosure/).check();
    await expect(continueButton).toBeDisabled();
    await page.getByLabel(/AI-assisted interview/).check();
    await expect(continueButton).toBeDisabled();
    await page.getByLabel(/Audio\/video recording/).check();
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

    // Realtime completion is not simulated here; this validates the authenticated completion surface
    // and the secure-session termination behavior that the realtime runtime will hand off to.
    await page.goto("/candidate/completed");
    await expect(page.getByRole("heading", { name: "Interview completed" })).toBeVisible();
    await expect(page.getByText(new RegExp(candidateIdentity.displayName))).toBeVisible();

    // Leave persistent candidate state neutral before ending the cookie-backed session. This keeps the
    // suite retry-safe even when a later assertion fails after the irreversible invitation consumption.
    await setCandidateConsents(page, false);

    await Promise.all([
      page.waitForURL(/\/candidate\/login$/),
      page.getByRole("button", { name: "End secure session" }).click(),
    ]);
    await expect(page.getByRole("heading", { name: "Open your interview invitation" })).toBeVisible();

    // Logged-out candidate access is closed, and the original invitation remains single-use.
    await page.goto("/candidate/setup");
    await page.waitForURL(/\/candidate\/login$/);
    await page.goto(`${BASE_URL}/candidate/invitation?token=${encodeURIComponent(invitation.developmentToken)}`);
    await expect(candidateAlert(page, /invalid|expired|already (?:been )?used/i)).toBeVisible();
  });
});

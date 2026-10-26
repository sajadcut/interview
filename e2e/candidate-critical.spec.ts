import { test, expect } from "./fixtures";
import { candidateCopy } from "../apps/web/lib/i18n";
import { candidateInterviewUiCopy } from "../apps/web/lib/candidate-interview-copy";
const copy = candidateCopy.fa;
const room = candidateInterviewUiCopy.fa;

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
  await expect(page.getByRole("heading", { name: copy.invitation.title })).toBeVisible();
  await expect(page.getByText(identity.displayName, { exact: true })).toBeVisible();
  await expect(page.getByText(identity.jobTitle, { exact: false })).toBeVisible();

  // A mistyped code must fail closed without consuming the invitation, allowing a valid retry.
  const wrongOtp = otp === "000000" ? "111111" : "000000";
  await page.getByLabel(copy.invitation.codeLabel).fill(wrongOtp);
  await page.getByRole("button", { name: copy.invitation.verify }).click();
  await expect(candidateAlert(page, "کد یک‌بارمصرف نامعتبر است")).toBeVisible();
  await expect(page).toHaveURL(/\/candidate\/invitation\?token=/);

  await page.getByLabel(copy.invitation.codeLabel).fill(otp);
  await Promise.all([
    page.waitForURL(/\/candidate\/setup$/),
    page.getByRole("button", { name: copy.invitation.verify }).click(),
  ]);
  await expect(page.getByRole("heading", { name: copy.setup.title })).toBeVisible();
}

test.describe("critical candidate flows", () => {
  test("candidate setup is protected without a candidate session", async ({ page }) => {
    await page.goto("/candidate/setup");
    await page.waitForURL(/\/candidate\/login$/);
    await expect(page.getByRole("heading", { name: copy.login.title })).toBeVisible();
  });

  test("invalid invitation fails closed in the browser", async ({ page }) => {
    await page.goto(`/candidate/invitation?token=${"x".repeat(43)}`);
    // Distinct backends may return differently localized invalid-token details.
    // Never rely on the precise wording: the candidate must see an error and
    // must not be offered any OTP verification form.
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByLabel(copy.invitation.codeLabel)).toHaveCount(0);
    await expect(page.getByRole("button", { name: copy.invitation.verify })).toHaveCount(0);
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

    await expect(page.getByRole("heading", { name: copy.invitation.title })).toBeVisible();
    await expect(page.getByText(candidateIdentity.displayName, { exact: true })).toBeVisible();
  });

  test("candidate verifies invitation, persists consent, recovers devices and reaches interview gate", async ({ page, context, candidateIdentity }) => {
    await signInRecruiter(page);
    const invitation = await createCandidateInvitation(page, candidateIdentity.applicationId);

    await context.clearCookies();
    await page.evaluate(() => window.localStorage.clear());
    await verifyCandidateInvitation(page, candidateIdentity, invitation.developmentToken, invitation.developmentOtp);

    // Candidate authentication is intentionally isolated from the internal recruiter surface.
    // A valid candidate cookie must never authorize integrity reports, even when the route shape is known.
    const integrityReport = await context.request.get(
      `${BASE_URL}/api/backend/v1/interviews/${candidateIdentity.applicationId}/integrity`,
    );
    // The internal recruiter route rejects candidate-only requests. A 400
    // (missing required recruiter tenant identity) also fails closed before
    // returning data; it must never return 2xx/3xx or a report payload.
    expect([400, 401, 403]).toContain(integrityReport.status());
    const deniedBody = await integrityReport.text();
    expect(deniedBody).not.toContain("integrityConcernScore");

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
    await expect(page.getByRole("heading", { name: copy.setup.title })).toBeVisible();
    await expect(page.getByText(new RegExp(candidateIdentity.displayName))).toBeVisible();

    // Interview access fails closed until persisted consent exists.
    await page.goto("/candidate/interview");
    await page.waitForURL(/\/candidate\/setup$/);
    await expect(page.getByRole("heading", { name: copy.setup.title })).toBeVisible();

    const continueButton = page.getByRole("button", { name: copy.setup.continue });
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

    await page.getByRole("button", { name: copy.setup.checkDevices }).click();
    await expect(candidateAlert(page, copy.setup.devicePermissionDenied)).toBeVisible();
    await expect(continueButton).toBeDisabled();

    await page.getByRole("button", { name: copy.setup.checkDevices }).click();
    await expect(page.getByRole("button", { name: copy.setup.checkAgain })).toBeVisible();
    await expect(continueButton).toBeDisabled();

    // The setup preview must keep the *actual* video track live, not simply
    // report granted permissions and immediately stop the webcam.
    const localPreview = page.locator('section[aria-label="پیش‌نمایش زنده دستگاه‌ها"] video');
    await expect.poll(() => localPreview.evaluate((element) =>
      ((element as HTMLVideoElement).srcObject as MediaStream | null)
        ?.getVideoTracks().some((track) => track.readyState === "live") ?? false,
    )).toBe(true);
    await page.getByRole("button", { name: copy.setup.stopPreview }).click();
    await expect.poll(() => localPreview.evaluate((element) =>
      (element as HTMLVideoElement).srcObject === null,
    )).toBe(true);
    await expect(continueButton).toBeDisabled();
    await page.getByRole("button", { name: copy.setup.checkDevices }).click();
    await expect(page.getByRole("button", { name: copy.setup.checkAgain })).toBeVisible();

    // Each required consent is independently necessary; readiness appears only after all three.
    await page.getByLabel(copy.setup.consents.privacy_disclosure[0]).check();
    await expect(continueButton).toBeDisabled();
    await page.getByLabel(copy.setup.consents.ai_interview[0]).check();
    await expect(continueButton).toBeDisabled();
    await page.getByLabel(copy.setup.consents.recording[0]).check();
    await expect(continueButton).toBeEnabled();

    await Promise.all([
      page.waitForURL(/\/candidate\/interview$/),
      continueButton.click(),
    ]);

    await expect(page.getByRole("heading", { name: room.title })).toBeVisible();
    await expect(page.getByText(new RegExp(`${copy.interview.hello} ${candidateIdentity.displayName}`))).toBeVisible();
    await expect(page.getByRole("status")).toContainText(room.network.online);

    // Continue from setup explicitly authorizes the candidate room to open its
    // own fresh tracks. A granted permission without live tracks is not ready.
    const interviewPreview = page.locator('video[muted]').first();
    await expect.poll(() => interviewPreview.evaluate((element) =>
      ((element as HTMLVideoElement).srcObject as MediaStream | null)
        ?.getVideoTracks().some((track) => track.readyState === "live") ?? false,
    )).toBe(true);
    await expect(page.getByRole("button", { name: room.controls.start })).toBeEnabled();

    await context.setOffline(true);
    await expect(candidateAlert(page, room.network.offline)).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByRole("status")).toContainText(room.network.restored);

    // Both the candidate session and consent ledger must survive reload; device readiness is intentionally per-page.
    await page.reload();
    await expect(page.getByRole("heading", { name: room.title })).toBeVisible();
    await expect(page.getByText(new RegExp(`${copy.interview.hello} ${candidateIdentity.displayName}`))).toBeVisible();

    // Realtime completion is not simulated here; this validates the authenticated completion surface
    // and the secure-session termination behavior that the realtime runtime will hand off to.
    await page.goto("/candidate/completed");
    await expect(page.getByRole("heading", { name: copy.completed.title })).toBeVisible();
    await expect(page.getByText(new RegExp(candidateIdentity.displayName))).toBeVisible();

    // Leave persistent candidate state neutral before ending the cookie-backed session. This keeps the
    // suite retry-safe even when a later assertion fails after the irreversible invitation consumption.
    await setCandidateConsents(page, false);

    await Promise.all([
      page.waitForURL(/\/candidate\/login$/),
      page.getByRole("button", { name: copy.completed.end }).click(),
    ]);
    await expect(page.getByRole("heading", { name: copy.login.title })).toBeVisible();

    // Logged-out candidate access is closed, and the original invitation remains single-use.
    await page.goto("/candidate/setup");
    await page.waitForURL(/\/candidate\/login$/);
    await page.goto(`${BASE_URL}/candidate/invitation?token=${encodeURIComponent(invitation.developmentToken)}`);
    await expect(candidateAlert(page, /دعوت‌نامه نامعتبر|دعوت‌نامه.*منقضی|قبلاً استفاده شده/)).toBeVisible();
  });
});

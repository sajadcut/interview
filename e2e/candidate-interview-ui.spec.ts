import { test, expect } from "./fixtures";
import {
  createCandidateInvitation,
  setCandidateConsents,
  signInRecruiter,
} from "./support";

async function authenticateCandidate(
  page: Parameters<typeof signInRecruiter>[0],
  applicationId: string,
) {
  await signInRecruiter(page);
  const invitation = await createCandidateInvitation(page, applicationId);
  await page.context().clearCookies();
  await page.evaluate(() => window.localStorage.clear());

  await page.goto(`/candidate/invitation?token=${encodeURIComponent(invitation.developmentToken)}`);
  await expect(page.getByRole("heading", { name: "Verify candidate access" })).toBeVisible();
  await page.getByLabel("One-time verification code").fill(invitation.developmentOtp);
  await Promise.all([
    page.waitForURL(/\/candidate\/setup$/),
    page.getByRole("button", { name: "Verify and continue" }).click(),
  ]);
}

async function prepareCandidateInterview(page: Parameters<typeof signInRecruiter>[0]) {
  await setCandidateConsents(page, false);
  await page.getByRole("button", { name: "Check camera and microphone" }).click();
  await expect(page.getByRole("button", { name: "Check again" })).toBeVisible();

  await page.getByLabel(/Privacy disclosure/).check();
  await page.getByLabel(/AI-assisted interview/).check();
  await page.getByLabel(/Audio\/video recording/).check();
  const continueButton = page.getByRole("button", { name: "Continue to interview" });
  await expect(continueButton).toBeEnabled();

  await page.evaluate(() => {
    const mediaDevices = navigator.mediaDevices;
    const originalGetUserMedia = mediaDevices.getUserMedia.bind(mediaDevices);
    const originalPermissionQuery = navigator.permissions.query.bind(navigator.permissions);

    Object.defineProperty(navigator.permissions, "query", {
      configurable: true,
      value: async (descriptor: PermissionDescriptor) => {
        if (window.location.pathname === "/candidate/interview") {
          if (descriptor.name === "microphone") return { state: "granted" } as PermissionStatus;
          if (descriptor.name === "camera") return { state: "denied" } as PermissionStatus;
        }
        return originalPermissionQuery(descriptor);
      },
    });

    mediaDevices.getUserMedia = async (constraints: MediaStreamConstraints) => {
      const asksForVideo = constraints?.video !== false && constraints?.video !== undefined;
      if (window.location.pathname === "/candidate/interview" && asksForVideo) {
        throw new DOMException("candidate-ui-e2e-camera-denied", "NotAllowedError");
      }
      return originalGetUserMedia(constraints);
    };
  });

  await Promise.all([
    page.waitForURL(/\/candidate\/interview$/),
    continueButton.click(),
  ]);
}

test("candidate interview UI handles permissions, fallback, runtime degradation and reconnect-safe network state", async ({
  page,
  context,
  candidateIdentity,
}, testInfo) => {
  await authenticateCandidate(page, candidateIdentity.applicationId);
  await prepareCandidateInterview(page);

  await expect(
    page.getByRole("heading", { name: "Your interview is ready for the Realtime stage" }),
  ).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Network is ready." })).toBeVisible();

  await page.getByRole("button", { name: "Enable camera and microphone" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Camera or microphone permission is blocked." })).toBeVisible();
  await expect(page.getByLabel("Microphone: Ready")).toBeVisible();
  await expect(page.getByLabel("Camera: Blocked")).toBeVisible();

  await page.getByRole("button", { name: "Try audio-only" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Audio-only fallback is active. Camera remains off." })).toBeVisible();
  await expect(page.getByLabel("Microphone: Ready")).toBeVisible();
  await expect(page.getByLabel("Camera: Unavailable")).toBeVisible();

  await page.getByRole("button", { name: "Check realtime availability" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Realtime interview service is not available yet." })).toBeVisible();
  await expect(page.getByText("Resume later with this secure session", { exact: true })).toBeVisible();
  await expect(page.getByText("Interview live", { exact: true })).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("candidate-interview-fallback.png"),
    fullPage: true,
  });

  await context.setOffline(true);
  await expect(page.getByRole("alert").filter({ hasText: "Network connection is offline" })).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByRole("status").filter({ hasText: "Network connection restored" })).toBeVisible();

  await setCandidateConsents(page, false);
});

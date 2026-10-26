import { test, expect } from "./fixtures";
import { candidateCopy } from "../apps/web/lib/i18n";
import { candidateInterviewUiCopy } from "../apps/web/lib/candidate-interview-copy";
const copy = candidateCopy.fa;
const room = candidateInterviewUiCopy.fa;

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
  await expect(page.getByRole("heading", { name: copy.invitation.title })).toBeVisible();
  await page.getByLabel(copy.invitation.codeLabel).fill(invitation.developmentOtp);
  await Promise.all([
    page.waitForURL(/\/candidate\/setup$/),
    page.getByRole("button", { name: copy.invitation.verify }).click(),
  ]);
}

async function prepareCandidateInterview(page: Parameters<typeof signInRecruiter>[0]) {
  await setCandidateConsents(page, false);
  await page.getByRole("button", { name: copy.setup.checkDevices }).click();
  await expect(page.getByRole("button", { name: copy.setup.checkAgain })).toBeVisible();

  await page.getByLabel(copy.setup.consents.privacy_disclosure[0]).check();
  await page.getByLabel(copy.setup.consents.ai_interview[0]).check();
  await page.getByLabel(copy.setup.consents.recording[0]).check();
  const continueButton = page.getByRole("button", { name: copy.setup.continue });
  await expect(continueButton).toBeEnabled();

  await page.addInitScript(() => {
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

test("candidate interview UI reaches candidate-scoped realtime readiness without engineering answer controls", async ({
  page,
  context,
  candidateIdentity,
}, testInfo) => {
  await authenticateCandidate(page, candidateIdentity.applicationId);
  await prepareCandidateInterview(page);

  await expect(
    page.getByRole("heading", { name: room.title }),
  ).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: room.network.online })).toBeVisible();

  await page.getByRole("button", { name: room.permissions.enableBoth }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: room.error.permission_denied }),
  ).toBeVisible();
  await expect(page.getByLabel(`${room.permissions.microphone}: ${room.permissions.granted}`)).toBeVisible();
  await expect(page.getByLabel(`${room.permissions.camera}: ${room.permissions.denied}`)).toBeVisible();

  await page.getByRole("button", { name: room.permissions.tryAudioOnly }).click();
  await expect(
    page.getByRole("status").filter({ hasText: room.permissions.audioOnlyActive }),
  ).toBeVisible();
  await expect(page.getByLabel(`${room.permissions.microphone}: ${room.permissions.granted}`)).toBeVisible();
  await expect(page.getByLabel(`${room.permissions.camera}: ${room.permissions.unavailable}`)).toBeVisible();

  const startButton = page.getByRole("button", { name: room.controls.start });
  await expect(startButton).toBeVisible();
  await expect(startButton).toBeEnabled();
  await expect(page.getByRole("button", { name: "Start answer" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Stop answer" })).toHaveCount(0);

  await page.screenshot({
    path: testInfo.outputPath("candidate-interview-ready.png"),
    fullPage: true,
  });

  await context.setOffline(true);
  await expect(
    page.getByRole("alert").filter({ hasText: room.network.offline }),
  ).toBeVisible();
  await context.setOffline(false);
  await expect(
    page.getByRole("status").filter({ hasText: room.network.restored }),
  ).toBeVisible();

  await setCandidateConsents(page, false);
});

test("audio-only setup handoff never re-requests a denied camera in the interview room", async ({
  page,
  candidateIdentity,
}) => {
  await authenticateCandidate(page, candidateIdentity.applicationId);
  await setCandidateConsents(page, false);

  // Instrument both pages, not just the setup document. A fresh document is
  // needed so the injected getUserMedia wrapper covers the initial device check.
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints: MediaStreamConstraints) => {
      if (constraints.video) {
        const key = "candidate-e2e-video-requests";
        window.sessionStorage.setItem(key, String(Number(window.sessionStorage.getItem(key) || "0") + 1));
        throw new DOMException("candidate-e2e-camera-denied-in-setup", "NotAllowedError");
      }
      return original(constraints);
    };
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: copy.setup.title })).toBeVisible();

  await page.getByRole("button", { name: copy.setup.checkDevices }).click();
  await expect(page.getByRole("button", { name: copy.setup.checkAgain })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: copy.setup.audioOnlyReady })).toBeVisible();
  expect(await page.evaluate(() => window.sessionStorage.getItem("candidate-e2e-video-requests"))).toBe("1");

  await page.getByLabel(copy.setup.consents.privacy_disclosure[0]).check();
  await page.getByLabel(copy.setup.consents.ai_interview[0]).check();
  await page.getByLabel(copy.setup.consents.recording[0]).check();
  await Promise.all([
    page.waitForURL(/\/candidate\/interview$/),
    page.getByRole("button", { name: copy.setup.continue }).click(),
  ]);

  await expect(page.getByRole("status").filter({ hasText: room.permissions.audioOnlyActive })).toBeVisible();
  await expect(page.getByRole("button", { name: room.controls.start })).toBeEnabled();
  const media = await page.evaluate(() => {
    const preview = document.querySelector("video[muted]") as HTMLVideoElement | null;
    const stream = preview?.srcObject as MediaStream | null;
    return {
      cameraRequests: window.sessionStorage.getItem("candidate-e2e-video-requests"),
      microphoneActive: Boolean(stream?.getAudioTracks().some((track) => track.readyState === "live")),
      cameraTracks: stream?.getVideoTracks().length ?? -1,
    };
  });
  expect(media).toEqual({ cameraRequests: "1", microphoneActive: true, cameraTracks: 0 });
  await setCandidateConsents(page, false);
});

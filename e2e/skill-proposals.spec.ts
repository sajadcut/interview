import { expect, test } from "./fixtures";
import { signInRecruiter, SEEDED_CANDIDATE_ID, BASE_URL, activeOrganizationId } from "./support";

test("AI skill suggestion requires explicit HR opt-in and disabled model fails closed", async ({ page }) => {
  await signInRecruiter(page);
  const organizationId = await activeOrganizationId(page);
  const resumeText = `Backend developer\\nSkills: Redis, PostgreSQL\\nBuilt Redis caches and PostgreSQL persistence services.\\nTest ${Date.now()}.`;
  const upload = await page.context().request.post(
    `${BASE_URL}/api/backend/v1/candidates/${SEEDED_CANDIDATE_ID}/resumes`,
    {
      headers: { origin: BASE_URL, "x-organization-id": organizationId },
      multipart: {
        file: { name: `proposal-${Date.now()}.txt`, mimeType: "text/plain", buffer: Buffer.from(resumeText, "utf8") },
      },
    },
  );
  expect(upload.ok(), `Upload returned ${upload.status()}: ${(await upload.text()).slice(0, 500)}`).toBe(true);
  const uploaded = await upload.json() as { id: string };

  let sentWithoutAction = 0;
  await page.route("**/skill-proposals/generate", (route) => {
    sentWithoutAction++;
    return route.continue();
  });
  await page.goto(`/app/candidates/${SEEDED_CANDIDATE_ID}`);
  await expect(page.getByRole("heading", { name: "پیشنهاد هوش مصنوعی برای مهارت‌های رزومه" })).toBeVisible();
  const panel = page.locator("div").filter({ has: page.getByRole("heading", { name: "پیشنهاد هوش مصنوعی برای مهارت‌های رزومه" }) }).last();
  await expect(page.getByRole("button", { name: "درخواست اختیاری پیشنهاد از مدل" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(sentWithoutAction).toBe(0);

  const result = await page.context().request.get(
    `${BASE_URL}/api/backend/v1/candidates/${SEEDED_CANDIDATE_ID}/resumes/${uploaded.id}/skill-proposals`,
    { headers: { origin: BASE_URL, "x-organization-id": organizationId } },
  );
  expect(result.ok()).toBe(true);
  expect(await result.json()).toEqual([]);
  // The provider is disabled in deterministic CI, so opt-in returns an explicit unavailable state.
  await page.getByRole("button", { name: "درخواست اختیاری پیشنهاد از مدل" }).click();
  await expect(page.getByRole("status").filter({ hasText: /مدل برای این رزومه آماده نیست/ })).toBeVisible();
  expect(sentWithoutAction).toBe(1);
  await expect(panel).toContainText("تنها با انتخاب صریح");
});

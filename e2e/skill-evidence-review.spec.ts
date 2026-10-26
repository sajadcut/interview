import { test, expect } from "./fixtures";
import { activeOrganizationId, BASE_URL, SEEDED_CANDIDATE_ID, signInRecruiter } from "./support";

test("HR reviews a source-anchored resume claim with versioned audit and stale-write protection", async ({ page }) => {
  await signInRecruiter(page);
  const organizationId = await activeOrganizationId(page);
  const headers = { origin: BASE_URL, "x-organization-id": organizationId };
  const uploadStamp = Date.now();
  const uploadName = `skills-${uploadStamp}.txt`;
  const source = `Test Candidate
Experience
Developed Redis caching with persistent keys.
Skills
Redis
Test source ${uploadStamp}
`;

  const upload = await page.context().request.post(
    `${BASE_URL}/api/backend/v1/candidates/${SEEDED_CANDIDATE_ID}/resumes`,
    {
      headers,
      multipart: {
        file: { name: uploadName, mimeType: "text/plain", buffer: Buffer.from(source, "utf8") },
      },
    },
  );
  expect(upload.ok(), `Resume upload returned ${upload.status()}: ${(await upload.text()).slice(0, 500)}`).toBe(true);
  const uploaded = await upload.json() as { id: string };
  expect(uploaded.id).toBeTruthy();

  const workspaceUrl = `${BASE_URL}/api/backend/v1/candidates/${SEEDED_CANDIDATE_ID}/intelligence-workspace`;
  const before = await page.context().request.get(workspaceUrl, { headers });
  expect(before.ok()).toBe(true);
  const beforePayload = await before.json() as {
    resumeSkillClaims: Array<{ id: string; resumeId: string; skillKey: string; reviewVersion: number; reviewState: string; claimText: string }>;
  };
  const claim = beforePayload.resumeSkillClaims.find((item) => item.resumeId === uploaded.id && item.skillKey === "redis");
  expect(claim, "An exact Redis statement should be source-anchored").toBeDefined();
  expect(claim?.reviewState).toBe("pending");
  expect(claim?.reviewVersion).toBe(0);
  expect(claim?.claimText).toContain("Redis");

  await page.goto(`/app/candidates/${SEEDED_CANDIDATE_ID}`);
  await expect(page.getByRole("heading", { name: "ادعاهای رزومه و مهارت‌های شغل" })).toBeVisible();
  await page.getByText(/همه ادعاهای مهارتی/).click();
  const skillCard = page.locator("div.rounded-lg.border.border-slate-100").filter({ hasText: uploadName }).first();
  await expect(skillCard).toBeVisible();
  await skillCard.getByRole("button", { name: "بازبینی ادعای رزومه" }).click();
  await skillCard.getByRole("textbox", { name: "دلیل مستند بازبینی" }).fill("عبارت Redis با متن اصلی رزومه تطبیق داده شد.");
  await skillCard.getByRole("button", { name: "ثبت نتیجه بازبینی" }).click();
  await expect(page.getByText(/بازبینی متن ادعای رزومه ثبت شد/)).toBeVisible();

  const after = await page.context().request.get(workspaceUrl, { headers });
  expect(after.ok()).toBe(true);
  const afterPayload = await after.json() as {
    resumeSkillClaims: Array<{ id: string; skillKey: string; reviewVersion: number; reviewState: string }>;
  };
  const reviewed = afterPayload.resumeSkillClaims.find((item) => item.id === claim?.id);
  expect(reviewed?.reviewState).toBe("confirmed");
  expect(reviewed?.reviewVersion).toBe(1);

  const history = await page.context().request.get(
    `${BASE_URL}/api/backend/v1/candidates/${SEEDED_CANDIDATE_ID}/skill-claims/${claim!.id}/reviews`,
    { headers },
  );
  expect(history.ok()).toBe(true);
  const events = await history.json() as Array<{ reviewVersion: number; reviewState: string; reviewReason: string }>;
  expect(events).toHaveLength(1);
  expect(events[0]?.reviewVersion).toBe(1);
  expect(events[0]?.reviewState).toBe("confirmed");

  const stale = await page.context().request.put(
    `${BASE_URL}/api/backend/v1/candidates/${SEEDED_CANDIDATE_ID}/skill-claims/${claim!.id}/review`,
    {
      headers: { ...headers, "content-type": "application/json" },
      data: { reviewState: "rejected", reviewReason: "This is a deliberately stale update", expectedVersion: 0 },
    },
  );
  expect(stale.status()).toBe(409);
});

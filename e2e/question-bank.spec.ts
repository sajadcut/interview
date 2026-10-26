import { test, expect } from "./fixtures";
import { SEEDED_JOB_ID, signInRecruiter } from "./support";

test("recruiter uploads a job-scoped question document and sees it after a reload", async ({ page }) => {
  await signInRecruiter(page);
  await page.goto("/app/question-bank");
  await expect(page.getByRole("heading", { name: "بانک سؤال" })).toBeVisible();
  await page.getByLabel("موقعیت شغلی").selectOption(SEEDED_JOB_ID);

  const uniqueName = `e2e-question-bank-${Date.now()}.txt`;
  const content = [
    "Senior .NET developer technical interview",
    "How would you design idempotency in a payment service?",
    "When is an optimistic concurrency token appropriate in Entity Framework?",
    "What distributed locking trade-offs would you consider for a high throughput service?",
  ].join("\n");

  await page.getByLabel("انتخاب فایل بانک سؤال").setInputFiles({
    name: uniqueName,
    mimeType: "text/plain",
    buffer: Buffer.from(content, "utf8"),
  });
  await expect(page.getByRole("status").filter({ hasText: "روی دیسک سرور ذخیره" })).toBeVisible();
  await expect(page.getByRole("heading", { name: uniqueName, exact: true })).toBeVisible();

  // A reload validates DB-backed listing, not just local component state.
  await page.reload();
  await page.getByLabel("موقعیت شغلی").selectOption(SEEDED_JOB_ID);
  await expect(page.getByRole("heading", { name: uniqueName, exact: true })).toBeVisible();
  await expect(page.getByText(/How would you design idempotency/)).toBeVisible();
});

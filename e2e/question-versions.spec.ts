import { expect, test } from "./fixtures";
import { SEEDED_JOB_ID, signInRecruiter } from "./support";

test("HR creates and rejects an anchored versioned question in the Persian bank", async ({ page }) => {
  await signInRecruiter(page);
  await page.goto("/app/question-bank");
  await page.getByLabel("موقعیت شغلی").selectOption(SEEDED_JOB_ID);
  const suffix = Date.now().toString(36);
  const question = `How would you make payment retries idempotent in service ${suffix}?`;
  const content = `Senior .NET job question bank.\n${question}\nExplain database constraints and durable state transitions in SQL Server.`;
  await page.getByLabel("انتخاب فایل بانک سؤال").setInputFiles({
    name: `versioned-${suffix}.txt`, mimeType: "text/plain",
    buffer: Buffer.from(content, "utf8"),
  });
  await expect(page.getByRole("status").filter({ hasText: "روی دیسک سرور ذخیره" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "سؤال‌های ساختاریافته و نسخه‌دار" })).toBeVisible();
  await page.getByRole("textbox", { name: "سؤال", exact: true }).fill(question);
  await page.getByRole("textbox", { name: "نقل‌قول مستقیم از سند" }).fill(question);
  await page.getByRole("button", { name: "ایجاد سؤال" }).click();
  await expect(page.getByRole("status").filter({ hasText: "نسخه سؤال ثبت شد" })).toBeVisible();
  const questionsSection = page.getByRole("heading", { name: "سؤال‌های ساختاریافته و نسخه‌دار" }).locator("..");
  const row = questionsSection.locator("article").filter({ hasText: question });
  await expect(row).toContainText("در انتظار بررسی");
  await page.reload();
  await page.getByLabel("موقعیت شغلی").selectOption(SEEDED_JOB_ID);
  const persisted = page.getByRole("heading", { name: "سؤال‌های ساختاریافته و نسخه‌دار" })
    .locator("..").locator("article").filter({ hasText: question });
  await expect(persisted).toContainText("نسخه ۱");
  await persisted.getByPlaceholder("دلیل مستند تصمیم انسانی").fill("This proposal needs a more precise expected answer");
  await persisted.getByRole("button", { name: "رد سؤال" }).click();
  await expect(page.getByRole("status").filter({ hasText: "نسخه سؤال رد شد" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "سؤال‌های ساختاریافته و نسخه‌دار" })
    .locator("..").locator("article").filter({ hasText: question })).toContainText("ردشده");
});

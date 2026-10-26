import { test, expect } from "./fixtures";
import { signInRecruiter } from "./support";

test("HR versions .NET skill requirements from the real job UI with persistence across reload", async ({ page }) => {
  await signInRecruiter(page);
  await page.goto("/app/jobs/new");
  await expect(page.getByRole("heading", { name: "ایجاد موقعیت شغلی و چارچوب ارزیابی مبتنی بر شواهد" })).toBeVisible();

  const title = "E2E .NET Skill Model " + Date.now().toString(36);
  await page.getByRole("textbox", { name: "عنوان", exact: true }).fill(title);
  await page.getByRole("textbox", { name: "دپارتمان", exact: true }).fill("Product");
  await page.getByRole("textbox", { name: /الزامات ضروری/ }).fill("C#\nASP.NET Core");
  await page.getByRole("textbox", { name: /معیارهای الزامی/ }).fill("C# coding\nDistributed systems reasoning");
  await Promise.all([
    page.waitForURL(/\/app\/jobs\/[0-9a-f-]{36}$/i),
    page.getByRole("button", { name: "ایجاد پیش‌نویس موقعیت" }).click(),
  ]);

  const jobId = page.url().match(/\/app\/jobs\/([0-9a-f-]{36})$/i)?.[1];
  expect(jobId).toBeTruthy();
  await page.goto(`/app/jobs/${jobId}/edit`);
  await expect(page.getByRole("heading", { name: "مدل مهارت‌های موردنیاز شغل" })).toBeVisible();
  await page.getByRole("button", { name: "افزودن مهارت" }).click();
  await expect(page.getByText("سی‌شارپ · C#", { exact: true })).toBeVisible();

  await page.getByLabel("سطح هدف (۱ تا ۵)").selectOption("4");
  await page.getByLabel("وزن اهمیت").fill("2.5");
  await page.getByLabel("حداقل شواهد").fill("2");
  await page.getByRole("button", { name: "ذخیره نسخه مهارت‌ها" }).click();
  await expect(page.getByRole("status")).toContainText("مهارت‌ها ذخیره شدند");

  await page.reload();
  await expect(page.getByText("سی‌شارپ · C#", { exact: true })).toBeVisible();
  await expect(page.getByLabel("سطح هدف (۱ تا ۵)")).toHaveValue("4");
  await expect(page.getByLabel("وزن اهمیت")).toHaveValue("2.5");
  await expect(page.getByLabel("حداقل شواهد")).toHaveValue("2");

  await page.getByRole("button", { name: "حذف از شغل" }).click();
  await page.getByRole("button", { name: "ذخیره نسخه مهارت‌ها" }).click();
  await expect(page.getByRole("status")).toContainText("مهارت‌ها ذخیره شدند");
  await page.reload();
  await expect(page.getByRole("button", { name: "حذف از شغل" })).toHaveCount(0);
  await expect(page.getByText("هنوز مهارتی برای این شغل سطح‌بندی نشده است.")).toBeVisible();
});

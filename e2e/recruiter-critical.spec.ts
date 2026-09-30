import { test, expect } from "./fixtures";
import { SEEDED_CANDIDATE_ID, SEEDED_JOB_ID, signInRecruiter } from "./support";

test.describe("critical recruiter flows", () => {
  test("unauthenticated internal workspace is gated", async ({ page }) => {
    await page.goto("/app");
    await expect(page.getByRole("heading", { name: "ورود سازمانی لازم است" })).toBeVisible();
    await expect(page.getByRole("link", { name: "ورود" })).toHaveAttribute("href", "/login");
  });

  test("recruiter authenticates with persisted session and reaches candidate intelligence", async ({ page }) => {
    await signInRecruiter(page);
    await page.evaluate(() => document.fonts.ready);
    const fontFamily = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    expect(fontFamily.toLowerCase()).toContain("traffic");

    // A full reload must preserve the server-side session and selected organization context.
    await page.reload();
    await expect(page.getByRole("heading", { name: "مرکز فرمان جذب و استخدام" })).toBeVisible();

    await page.goto(`/app/candidates/${SEEDED_CANDIDATE_ID}`);
    await expect(page.getByRole("heading", { name: "Ali Rahimi" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "دریافت و پردازش رزومه" })).toBeVisible();
    await expect(page.getByText("Backend Lead", { exact: false })).toBeVisible();
    await expect(page.getByText("Digikala", { exact: false })).toBeVisible();
  });

  test("recruiter records a reasoned pipeline move and saves a human shortlist", async ({ page }) => {
    await signInRecruiter(page);
    await page.goto(`/app/jobs/${SEEDED_JOB_ID}`);
    await expect(page.getByRole("heading", { name: "Senior Backend Engineer" })).toBeVisible();

    let saraRow = page.getByRole("row").filter({ hasText: "Sara Mohammadi" });
    await expect(saraRow).toBeVisible();

    // The seeded database is intentionally persistent across CI retries. Repair the fixture through
    // the same audited UI mutation if a previous failed attempt stopped after moving Sara forward.
    const currentStage = (await saraRow.getByRole("cell").nth(2).innerText()).trim();
    if (currentStage !== "غربالگری") {
      page.once("dialog", async (dialog) => {
        expect(dialog.type()).toBe("prompt");
        await dialog.accept("E2E retry fixture reset to screening");
      });
      await saraRow.getByRole("button", { name: "غربالگری", exact: true }).click();
      await expect(page.getByText("پرونده به مرحله «غربالگری» منتقل شد.", { exact: true })).toBeVisible();
      saraRow = page.getByRole("row").filter({ hasText: "Sara Mohammadi" });
    }
    await expect(saraRow.getByRole("cell").nth(2)).toContainText("غربالگری");

    // Consequential pipeline mutations require an explicit human reason. Cancelling the prompt
    // must not produce a request or optimistic UI transition.
    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("prompt");
      await dialog.dismiss();
    });
    await saraRow.getByRole("button", { name: "بررسی", exact: true }).click();
    await expect(saraRow.getByRole("cell").nth(2)).toContainText("غربالگری");

    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("prompt");
      await dialog.accept("E2E verified recruiter stage transition");
    });
    await saraRow.getByRole("button", { name: "مصاحبه", exact: true }).click();
    await expect(page.getByText("پرونده به مرحله «مصاحبه» منتقل شد.", { exact: true })).toBeVisible();

    saraRow = page.getByRole("row").filter({ hasText: "Sara Mohammadi" });
    await expect(saraRow.getByRole("cell").nth(2)).toContainText("مصاحبه");

    // Verify the mutation is persisted rather than only reflected in local React state.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Senior Backend Engineer" })).toBeVisible();
    saraRow = page.getByRole("row").filter({ hasText: "Sara Mohammadi" });
    await expect(saraRow.getByRole("cell").nth(2)).toContainText("مصاحبه");

    await saraRow.getByRole("checkbox").check();
    const saveShortlist = page.getByRole("button", { name: "ذخیره فهرست نهایی (1)" });
    await expect(saveShortlist).toBeEnabled();
    await saveShortlist.click();
    await expect(page.getByText("1 کاندیدا در فهرست نهایی ذخیره شدند.", { exact: true })).toBeVisible();

    // Return the durable seeded pipeline fixture to its canonical state. If the test fails before
    // this cleanup, the repair step at the start makes the next retry deterministic.
    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("prompt");
      await dialog.accept("E2E fixture cleanup to screening");
    });
    await saraRow.getByRole("button", { name: "غربالگری", exact: true }).click();
    await expect(page.getByText("پرونده به مرحله «غربالگری» منتقل شد.", { exact: true })).toBeVisible();
    saraRow = page.getByRole("row").filter({ hasText: "Sara Mohammadi" });
    await expect(saraRow.getByRole("cell").nth(2)).toContainText("غربالگری");
  });

  test("recruiter rejects unsupported resume input then ingests a real resume with evidence", async ({ page }) => {
    await signInRecruiter(page);
    await page.goto(`/app/candidates/${SEEDED_CANDIDATE_ID}`);
    await expect(page.getByRole("heading", { name: "دریافت و پردازش رزومه" })).toBeVisible();

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: "unsupported-resume.bin",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("not a supported resume", "utf8"),
    });
    await expect(page.getByText("فرمت‌های پشتیبانی‌شده رزومه PDF، DOCX و متن UTF-8 هستند.")).toBeVisible();

    const resumeText = [
      "Ali Rahimi",
      "ali.rahimi@example.local",
      "Backend Lead at Digikala",
      "Tehran, Iran",
      "Skills",
      "C# .NET PostgreSQL Kubernetes",
      "Experience",
      "Backend Lead | Digikala | 2022 - Present",
      "Designed reliable distributed services with PostgreSQL, idempotency and Kubernetes.",
    ].join("\n");

    await fileInput.setInputFiles({
      name: "ali-rahimi-e2e-resume.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(resumeText, "utf8"),
    });

    await expect(page.getByText(/رزومه پردازش شد: \d+ بخش و \d+ شاهد\./)).toBeVisible();
    await expect(page.getByText("ali-rahimi-e2e-resume.txt")).toBeVisible();
    await expect(page.getByText("تکمیل‌شده", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("مهارت‌ها و وضعیت تأیید")).toBeVisible();
  });

  test("recruiter validates rubric requirements and creates a persisted job through the UI", async ({ page }) => {
    await signInRecruiter(page);
    await page.goto("/app/jobs/new");
    await expect(page.getByRole("heading", { name: "ایجاد موقعیت شغلی و چارچوب ارزیابی مبتنی بر شواهد" })).toBeVisible();

    const suffix = Date.now().toString(36);
    const jobTitle = `E2E Platform Engineer ${suffix}`;
    await page.getByRole("textbox", { name: "عنوان", exact: true }).fill(jobTitle);
    await page.getByRole("textbox", { name: "دپارتمان", exact: true }).fill("Platform Engineering");
    await page.getByRole("textbox", { name: "موقعیت", exact: true }).fill("Remote");
    await page.getByRole("textbox", { name: "سطح ارشدیت", exact: true }).fill("Senior");
    await page.getByRole("textbox", { name: /الزامات ضروری/ }).fill("TypeScript\nPostgreSQL\nDistributed systems");
    await page.getByRole("textbox", { name: /الزامات ترجیحی/ }).fill("Kubernetes\nObservability");

    // A job cannot be submitted without an evidence rubric.
    await page.getByRole("button", { name: "ایجاد پیش‌نویس موقعیت" }).click();
    await expect(page.getByText("حداقل یک معیار ارزیابی وارد کنید.")).toBeVisible();
    await expect(page).toHaveURL(/\/app\/jobs\/new$/);

    await page.getByRole("textbox", { name: /معیارهای چارچوب ارزیابی/ }).fill("System design\nReliability reasoning");
    await Promise.all([
      page.waitForURL(/\/app\/jobs\/[0-9a-f-]{36}$/i),
      page.getByRole("button", { name: "ایجاد پیش‌نویس موقعیت" }).click(),
    ]);
    await expect(page.getByText(jobTitle, { exact: false }).first()).toBeVisible();
  });

  test("recruiter securely signs out and cannot reuse the protected workspace", async ({ page }) => {
    await signInRecruiter(page);
    expect(await page.evaluate(() => window.localStorage.getItem("interview.organizationId"))).toBeTruthy();

    await Promise.all([
      page.waitForURL(/\/login$/),
      page.getByRole("button", { name: "خروج" }).click(),
    ]);
    await expect(page.getByRole("heading", { name: "ورود به پنل سازمان" })).toBeVisible();
    expect(await page.evaluate(() => window.localStorage.getItem("interview.organizationId"))).toBeNull();

    await page.goto("/app");
    await expect(page.getByRole("heading", { name: "ورود سازمانی لازم است" })).toBeVisible();
  });
});

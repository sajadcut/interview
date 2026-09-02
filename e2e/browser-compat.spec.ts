import { test, expect } from "./fixtures";
import { SEEDED_CANDIDATE_ID, signInRecruiter } from "./support";

test.describe("browser compatibility smoke", () => {
  test("recruiter authentication and persisted candidate workspace render outside Chromium", async ({ page }) => {
    await signInRecruiter(page);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Hiring command center" })).toBeVisible();

    await page.goto(`/app/candidates/${SEEDED_CANDIDATE_ID}`);
    await expect(page.getByRole("heading", { name: "Ali Rahimi" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Resume ingestion" })).toBeVisible();
  });

  test("candidate public entry and protected setup render outside Chromium", async ({ page }) => {
    await page.goto("/candidate/login");
    await expect(page.getByRole("heading", { name: "Open your interview invitation" })).toBeVisible();

    await page.goto("/candidate/setup");
    await page.waitForURL(/\/candidate\/login$/);
    await expect(page.getByRole("heading", { name: "Open your interview invitation" })).toBeVisible();
  });
});

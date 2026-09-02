import { test, expect } from "./fixtures";
import { SEEDED_CANDIDATE_ID, signInRecruiter } from "./support";

test.describe("mobile recruiter smoke", () => {
  test("recruiter session and primary workspace remain usable on a mobile viewport", async ({ page }) => {
    await signInRecruiter(page);

    const mobileNavigation = page.getByRole("navigation", { name: "Mobile navigation" });
    await expect(mobileNavigation).toBeVisible();
    await expect(mobileNavigation.getByRole("link", { name: "Home", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("link", { name: "Create Job" })).toBeVisible();

    await page.goto(`/app/candidates/${SEEDED_CANDIDATE_ID}`);
    await expect(page.getByRole("heading", { name: "Ali Rahimi" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Resume ingestion" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: "Ali Rahimi" })).toBeVisible();
  });
});

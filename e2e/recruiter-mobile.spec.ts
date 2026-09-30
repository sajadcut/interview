import { test, expect } from "./fixtures";
import { SEEDED_CANDIDATE_ID, signInRecruiter } from "./support";

test.describe("mobile recruiter smoke", () => {
  test("recruiter session and primary workspace remain usable on a mobile viewport", async ({ page }) => {
    await signInRecruiter(page);

    const expectRtlWithoutDocumentOverflow = async () => {
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      const fitsViewport = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      );
      expect(fitsViewport).toBe(true);
    };

    await expectRtlWithoutDocumentOverflow();
    // Font loading is part of the mobile acceptance gate, not merely a CSS declaration.
    await page.evaluate(() => document.fonts.ready);
    const fontStatus = await page.evaluate(() => {
      const variable = getComputedStyle(document.documentElement).getPropertyValue("--font-b-traffic").trim();
      const family = getComputedStyle(document.body).fontFamily;
      return {
        variable,
        family,
        loaded: Boolean(variable) && document.fonts.check(`16px ${variable.split(",")[0]?.trim()}`),
      };
    });
    expect(fontStatus.variable).toBeTruthy();
    expect(fontStatus.family).toContain(fontStatus.variable.split(",")[0]?.trim().replaceAll('"', ""));
    expect(fontStatus.loaded).toBe(true);

    // Font metric changes must not introduce page-wide overflow on phone, tablet or desktop.
    for (const width of [390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await expectRtlWithoutDocumentOverflow();
    }
    await page.setViewportSize({ width: 412, height: 915 });

    const mobileNavigation = page.getByRole("navigation", { name: "پیمایش موبایل" });
    await expect(mobileNavigation).toBeVisible();
    await expect(mobileNavigation.getByRole("link", { name: "خانه", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("link", { name: "ایجاد موقعیت شغلی" })).toBeVisible();

    await page.goto(`/app/candidates/${SEEDED_CANDIDATE_ID}`);
    await expect(page.getByRole("heading", { name: "Ali Rahimi" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "دریافت و پردازش رزومه" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "پیمایش موبایل" })).toBeVisible();
    await expectRtlWithoutDocumentOverflow();

    for (const route of [
      "/app/hiring-requests",
      "/app/jobs",
      "/app/candidates",
      "/app/talent",
      "/app/interviews",
      "/app/inbox",
      "/app/analytics",
      "/app/automations",
      "/app/integrations",
      "/app/settings",
    ]) {
      await page.goto(route);
      await expect(page.getByRole("navigation", { name: "پیمایش موبایل" })).toBeVisible();
      await expectRtlWithoutDocumentOverflow();
    }

    await page.goto(`/app/candidates/${SEEDED_CANDIDATE_ID}`);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Ali Rahimi" })).toBeVisible();
  });
});

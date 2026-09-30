import { test, expect } from "./fixtures";
import { SEEDED_CANDIDATE_ID, signInRecruiter } from "./support";

test.describe("mobile recruiter smoke", () => {
  test("recruiter session and primary workspace remain usable on a mobile viewport", async ({ page }, testInfo) => {
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
    await page.evaluate(async () => {
      const variable = getComputedStyle(document.documentElement).getPropertyValue("--font-b-traffic").trim();
      const family = variable.split(",")[0]?.trim();
      if (family) await document.fonts.load(`400 17px ${family}`, "دستیار هوشمند جذب");
      await document.fonts.ready;
    });
    const fontStatus = await page.evaluate(() => {
      const variable = getComputedStyle(document.documentElement).getPropertyValue("--font-b-traffic").trim();
      const display = document.querySelector<HTMLElement>(".font-b-traffic-display");
      const expected = variable.split(",")[0]?.trim().replaceAll('"', "").replaceAll("'", "");
      return {
        variable,
        bodyFamily: getComputedStyle(document.body).fontFamily,
        displayFamily: display ? getComputedStyle(display).fontFamily : "",
        titleFamily: getComputedStyle(document.querySelector("main h1")!).fontFamily,
        loaded: Boolean(expected) && Array.from(document.fonts).some((face) =>
          face.family.replaceAll('"', "").replaceAll("'", "") === expected && face.status === "loaded",
        ),
      };
    });
    expect(fontStatus.variable).toBeTruthy();
    expect(fontStatus.bodyFamily.toLowerCase()).toContain("tahoma");
    expect(fontStatus.displayFamily).toContain(fontStatus.variable.split(",")[0]?.trim().replaceAll('"', ""));
    expect(fontStatus.titleFamily).toContain(fontStatus.variable.split(",")[0]?.trim().replaceAll('"', ""));
    expect(fontStatus.loaded).toBe(true);

    // Font metric changes must not introduce page-wide overflow on phone, tablet or desktop.
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await expectRtlWithoutDocumentOverflow();
      await page.screenshot({
        path: testInfo.outputPath(`persian-ui-dashboard-${width}.png`),
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 412, height: 915 });

    const mobileNavigation = page.getByRole("navigation", { name: "پیمایش موبایل" });
    await expect(mobileNavigation).toBeVisible();
    await expect(mobileNavigation.getByRole("link", { name: "خانه", exact: true })).toHaveAttribute("aria-current", "page");
    const navTypography = await mobileNavigation.getByRole("link", { name: "خانه", exact: true }).evaluate((element) => {
      const style = getComputedStyle(element);
      return { family: style.fontFamily, size: parseFloat(style.fontSize), spacing: style.letterSpacing };
    });
    expect(navTypography.family.toLowerCase()).toContain("tahoma");
    expect(navTypography.size).toBeGreaterThanOrEqual(13);
    expect(navTypography.spacing).toBe("normal");
    await expect(page.getByRole("link", { name: "ایجاد موقعیت" })).toBeVisible();

    await page.goto(`/app/candidates/${SEEDED_CANDIDATE_ID}`);
    await expect(page.getByRole("heading", { name: "Ali Rahimi" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "دریافت و پردازش رزومه" })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("persian-ui-candidate-mobile.png"),
      fullPage: true,
    });
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
      if (route === "/app/jobs") {
        const search = page.getByPlaceholder("جست‌وجو بر اساس عنوان، تیم، محل یا وضعیت...");
        await expect(search).toBeVisible();
        const fontSize = await search.evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
        expect(fontSize).toBeGreaterThanOrEqual(16);
      }
    }

    await page.goto(`/app/candidates/${SEEDED_CANDIDATE_ID}`);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Ali Rahimi" })).toBeVisible();
  });
});

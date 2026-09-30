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
    // Check the self-hosted Persian family, including its real regular and bold faces.
    const fontStatus = await page.evaluate(async () => {
      const variable = getComputedStyle(document.documentElement).getPropertyValue("--font-iran-sans-x").trim();
      const primary = variable.split(",")[0]?.trim() ?? "";
      const clean = (name: string) => name.replaceAll('"', "").replaceAll("'", "").trim();
      if (primary) {
        await Promise.all([
          document.fonts.load(`400 14px ${primary}`, "متن فارسی"),
          document.fonts.load(`700 24px ${primary}`, "عنوان فارسی"),
        ]);
      }
      await document.fonts.ready;
      const faces = Array.from(document.fonts);
      const faceLoaded = (weight: string) => faces.some((face) =>
        clean(face.family) === clean(primary) && face.weight === weight && face.status === "loaded",
      );
      const mainTitle = document.querySelector<HTMLElement>("main h1");
      return {
        variable,
        primary: clean(primary),
        bodyFamily: getComputedStyle(document.body).fontFamily,
        titleFamily: mainTitle ? getComputedStyle(mainTitle).fontFamily : "",
        regularLoaded: faceLoaded("400"),
        boldLoaded: faceLoaded("700"),
      };
    });
    expect(fontStatus.variable).toBeTruthy();
    expect(fontStatus.bodyFamily).toContain(fontStatus.primary);
    expect(fontStatus.titleFamily).toContain(fontStatus.primary);
    expect(fontStatus.regularLoaded).toBe(true);
    expect(fontStatus.boldLoaded).toBe(true);

    // Font metric changes must not introduce page-wide overflow on phone, tablet or desktop.
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await expectRtlWithoutDocumentOverflow();
      await page.screenshot({
        path: testInfo.outputPath(`iransansx-dashboard-${width}.png`),
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
    expect(navTypography.family).toContain(fontStatus.primary);
    expect(navTypography.size).toBeGreaterThanOrEqual(13);
    expect(navTypography.spacing).toBe("normal");
    await expect(page.getByRole("link", { name: "ایجاد موقعیت" })).toBeVisible();

    await page.goto(`/app/candidates/${SEEDED_CANDIDATE_ID}`);
    await expect(page.getByRole("heading", { name: "Ali Rahimi" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "دریافت و پردازش رزومه" })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("iransansx-candidate-mobile.png"),
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

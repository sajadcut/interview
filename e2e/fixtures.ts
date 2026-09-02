import { expect, test as base } from "@playwright/test";

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const diagnostics: string[] = [];

    page.on("pageerror", (error) => {
      diagnostics.push(`pageerror: ${error.message}`);
    });
    page.on("console", (message) => {
      if (message.type() === "error") diagnostics.push(`console.error: ${message.text()}`);
    });
    page.on("response", (response) => {
      if (response.status() >= 500 && response.url().includes("/api/backend")) {
        diagnostics.push(`backend ${response.status()}: ${response.request().method()} ${response.url()}`);
      }
    });

    await use(page);

    if (diagnostics.length > 0) {
      await testInfo.attach("browser-diagnostics.txt", {
        body: Buffer.from(diagnostics.join("\n"), "utf8"),
        contentType: "text/plain",
      });
    }
    expect(diagnostics, "unexpected browser/runtime errors").toEqual([]);
  },
});

export { expect } from "@playwright/test";

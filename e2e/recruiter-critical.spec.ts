import { test, expect } from "./fixtures";
import { SEEDED_CANDIDATE_ID, signInRecruiter } from "./support";

test.describe("critical recruiter flows", () => {
  test("unauthenticated internal workspace is gated", async ({ page }) => {
    await page.goto("/app");
    await expect(page.getByRole("heading", { name: "ورود سازمانی لازم است" })).toBeVisible();
    await expect(page.getByRole("link", { name: "ورود" })).toHaveAttribute("href", "/login");
  });

  test("recruiter authenticates with persisted session and reaches candidate intelligence", async ({ page }) => {
    await signInRecruiter(page);
    await page.goto(`/app/candidates/${SEEDED_CANDIDATE_ID}`);

    await expect(page.getByRole("heading", { name: "Ali Rahimi" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Resume ingestion" })).toBeVisible();
    await expect(page.getByText("Backend Lead", { exact: false })).toBeVisible();
    await expect(page.getByText("Digikala", { exact: false })).toBeVisible();
  });

  test("recruiter uploads a real resume through the browser and sees ingestion evidence", async ({ page }) => {
    await signInRecruiter(page);
    await page.goto(`/app/candidates/${SEEDED_CANDIDATE_ID}`);
    await expect(page.getByRole("heading", { name: "Resume ingestion" })).toBeVisible();

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

    await page.locator('input[type="file"]').setInputFiles({
      name: "ali-rahimi-e2e-resume.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(resumeText, "utf8"),
    });

    await expect(page.getByText(/Resume processed: \d+ chunks, \d+ evidence records\./)).toBeVisible();
    await expect(page.getByText("ali-rahimi-e2e-resume.txt")).toBeVisible();
    await expect(page.getByText("completed", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Skills & verification")).toBeVisible();
  });

  test("recruiter creates a job and rubric through the UI", async ({ page }) => {
    await signInRecruiter(page);
    await page.goto("/app/jobs/new");
    await expect(page.getByRole("heading", { name: "Create a job and evidence rubric" })).toBeVisible();

    const suffix = Date.now().toString(36);
    const jobTitle = `E2E Platform Engineer ${suffix}`;
    await page.getByRole("textbox", { name: "عنوان", exact: true }).fill(jobTitle);
    await page.getByRole("textbox", { name: "دپارتمان", exact: true }).fill("Platform Engineering");
    await page.getByRole("textbox", { name: "موقعیت", exact: true }).fill("Remote");
    await page.getByRole("textbox", { name: "Seniority", exact: true }).fill("Senior");
    await page.getByRole("textbox", { name: /Must-have requirements/ }).fill("TypeScript\nPostgreSQL\nDistributed systems");
    await page.getByRole("textbox", { name: /Nice-to-have requirements/ }).fill("Kubernetes\nObservability");
    await page.getByRole("textbox", { name: /Rubric criteria/ }).fill("System design\nReliability reasoning");

    await Promise.all([
      page.waitForURL(/\/app\/jobs\/[0-9a-f-]{36}$/i),
      page.getByRole("button", { name: "Create draft job" }).click(),
    ]);
    await expect(page.getByText(jobTitle, { exact: false }).first()).toBeVisible();
  });
});

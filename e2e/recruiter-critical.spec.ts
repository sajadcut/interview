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

    // A full reload must preserve the server-side session and selected organization context.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Hiring command center" })).toBeVisible();

    await page.goto(`/app/candidates/${SEEDED_CANDIDATE_ID}`);
    await expect(page.getByRole("heading", { name: "Ali Rahimi" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Resume ingestion" })).toBeVisible();
    await expect(page.getByText("Backend Lead", { exact: false })).toBeVisible();
    await expect(page.getByText("Digikala", { exact: false })).toBeVisible();
  });

  test("recruiter records a reasoned pipeline move and saves a human shortlist", async ({ page }) => {
    await signInRecruiter(page);
    await page.goto(`/app/jobs/${SEEDED_JOB_ID}`);
    await expect(page.getByRole("heading", { name: "Senior Backend Engineer" })).toBeVisible();

    let saraRow = page.getByRole("row").filter({ hasText: "Sara Mohammadi" });
    await expect(saraRow).toBeVisible();
    await expect(saraRow.getByRole("cell").nth(2)).toContainText("screening");

    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("prompt");
      await dialog.accept("E2E verified recruiter stage transition");
    });
    await saraRow.getByRole("button", { name: "interview", exact: true }).click();
    await expect(page.getByText("Application moved to interview.", { exact: true })).toBeVisible();

    saraRow = page.getByRole("row").filter({ hasText: "Sara Mohammadi" });
    await expect(saraRow.getByRole("cell").nth(2)).toContainText("interview");

    // Verify the mutation is persisted rather than only reflected in local React state.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Senior Backend Engineer" })).toBeVisible();
    saraRow = page.getByRole("row").filter({ hasText: "Sara Mohammadi" });
    await expect(saraRow.getByRole("cell").nth(2)).toContainText("interview");

    await saraRow.getByRole("checkbox").check();
    const saveShortlist = page.getByRole("button", { name: "Save shortlist (1)" });
    await expect(saveShortlist).toBeEnabled();
    await saveShortlist.click();
    await expect(page.getByText("1 candidates saved to shortlist.", { exact: true })).toBeVisible();
  });

  test("recruiter rejects unsupported resume input then ingests a real resume with evidence", async ({ page }) => {
    await signInRecruiter(page);
    await page.goto(`/app/candidates/${SEEDED_CANDIDATE_ID}`);
    await expect(page.getByRole("heading", { name: "Resume ingestion" })).toBeVisible();

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: "unsupported-resume.bin",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("not a supported resume", "utf8"),
    });
    await expect(page.getByText("Supported resume formats are PDF, DOCX and UTF-8 plain text.")).toBeVisible();

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

    await expect(page.getByText(/Resume processed: \d+ chunks, \d+ evidence records\./)).toBeVisible();
    await expect(page.getByText("ali-rahimi-e2e-resume.txt")).toBeVisible();
    await expect(page.getByText("completed", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Skills & verification")).toBeVisible();
  });

  test("recruiter validates rubric requirements and creates a persisted job through the UI", async ({ page }) => {
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

    // A job cannot be submitted without an evidence rubric.
    await page.getByRole("button", { name: "Create draft job" }).click();
    await expect(page.getByText("حداقل یک معیار ارزیابی وارد کنید.")).toBeVisible();
    await expect(page).toHaveURL(/\/app\/jobs\/new$/);

    await page.getByRole("textbox", { name: /Rubric criteria/ }).fill("System design\nReliability reasoning");
    await Promise.all([
      page.waitForURL(/\/app\/jobs\/[0-9a-f-]{36}$/i),
      page.getByRole("button", { name: "Create draft job" }).click(),
    ]);
    await expect(page.getByText(jobTitle, { exact: false }).first()).toBeVisible();
  });
});

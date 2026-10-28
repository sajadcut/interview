import { expect, test } from "./fixtures";
import { SEEDED_JOB_ID, signInRecruiter } from "./support";

test("LLM drafting requires explicit per-document consent, never starts on upload", async ({ page }) => {
  await signInRecruiter(page);
  let proposalRequests = 0;
  await page.route("**/v1/question-bank/jobs/**/questions/propose", async route => {
    proposalRequests++;
    const body = route.request().postDataJSON() as {
      documentId: string; consentToRemoteProcessing: boolean;
    };
    expect(body.documentId).toBeTruthy();
    expect(body.consentToRemoteProcessing).toBe(true);
    await route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ status: "unavailable", persistedCount: 0 }) });
  });
  await page.goto("/app/question-bank");
  await page.getByLabel("موقعیت شغلی").selectOption(SEEDED_JOB_ID);
  const excerpt = "How would you test concurrent retry safety in a payment service?";
  await page.getByLabel("انتخاب فایل بانک سؤال").setInputFiles({
    name: `llm-optin-${Date.now()}.txt`, mimeType: "text/plain",
    buffer: Buffer.from(`Reference for job reviewers. ${excerpt} Discuss SQL constraints and concurrency.`, "utf8"),
  });
  await expect(page.getByRole("status").filter({ hasText: "روی دیسک سرور ذخیره" })).toBeVisible();
  expect(proposalRequests).toBe(0);
  const button = page.getByRole("button", { name: "پیشنهاد سؤال با هوش مصنوعی" });
  await expect(button).toBeDisabled();
  await page.getByRole("checkbox", { name: "اجازه ارسال متن سند به مدل سازمانی" }).check();
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.getByRole("alert").filter({ hasText: "مدل سازمانی آماده نیست" })).toBeVisible();
  expect(proposalRequests).toBe(1);
  await expect(page.getByRole("checkbox", { name: "اجازه ارسال متن سند به مدل سازمانی" })).not.toBeChecked();
});

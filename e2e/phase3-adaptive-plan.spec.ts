import { test, expect } from "./fixtures";
import { signInRecruiter } from "./support";

const sessionId = "80808080-8080-4080-8080-808080808080";

test("HR review displays immutable adaptive skill plan, quotas and gaps without implying a skill grade", async ({ page }) => {
  await signInRecruiter(page);
  await page.route(`**/v1/interviews/${sessionId}/adaptive-plan`, async route => {
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({
        sessionId, contractVersion: "adaptive-skill-plan.v1",sourcePlanVersion:2,
        status:"completed",createdAt:"2026-10-28T10:00:00.000Z",
        snapshotSha256:"f".repeat(64),commonQuestionVersionIds:["11111111-1111-4111-8111-111111111111"],
        adaptivePolicy:{commonFirst:true,deterministicFallback:true},
        criteria:[{criterionKey:"backend_depth",required:true,minimumEvidence:2,maxQuestions:3,questionCount:2,evidenceCount:1}],
        skills:[
          {skillKey:"dotnet",criterionKey:"backend_depth",required:true,minimumEvidence:2,evidenceCount:1,quotaState:"evidence_gap"},
          {skillKey:"redis",criterionKey:null,required:false,minimumEvidence:1,evidenceCount:0,quotaState:"unmapped"}
        ],
      }),
    });
  });
  await page.goto(`/app/interviews/${sessionId}`);
  const panel=page.getByRole("region",{name:"برنامه تطبیقی مهارت‌ها"});
  await expect(panel).toBeVisible();
  await expect(panel.getByText("dotnet")).toBeVisible();
  await expect(panel.getByText("redis")).toBeVisible();
  await expect(panel.getByText("شواهد ناکافی")).toBeVisible();
  await expect(panel.getByText("بدون نگاشت Rubric")).toBeVisible();
  await expect(panel.getByText(/تعداد شواهد به‌تنهایی اثبات توانایی نیست/)).toBeVisible();
});

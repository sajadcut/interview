import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import { activeOrganizationId, BASE_URL, signInRecruiter } from "./support";

async function apiJson<T>(
  page: Page,
  organizationId: string,
  method: "GET" | "POST" | "PUT" | "PATCH",
  path: string,
  data?: unknown,
  expectedStatus?: number,
): Promise<T> {
  const response = await page.context().request.fetch(`${BASE_URL}/api/backend${path}`, {
    method,
    headers: {
      origin: BASE_URL,
      "content-type": "application/json",
      "x-organization-id": organizationId,
    },
    ...(data === undefined ? {} : { data }),
  });
  const rawBody = await response.text();
  if (expectedStatus !== undefined) {
    expect(response.status(), `${method} ${path}: ${rawBody.slice(0, 1200)}`).toBe(expectedStatus);
  } else {
    expect(response.ok(), `${method} ${path}: ${rawBody.slice(0, 1200)}`).toBeTruthy();
  }
  if (!rawBody) return undefined as T;
  return JSON.parse(rawBody) as T;
}

test.describe("M1 closure: Job -> Candidate -> Evidence", () => {
  test("pins rubric provenance and keeps scorecard finalization idempotent across rubric versions", async ({ page }) => {
    await signInRecruiter(page);
    const organizationId = await activeOrganizationId(page);
    const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    const job = await apiJson<{
      id: string;
      rubricVersionId: string;
    }>(page, organizationId, "POST", "/v1/jobs", {
      title: `M1 Closure Engineer ${suffix}`,
      department: "Platform",
      location: "Remote",
      seniority: "Senior",
      summary: "M1 closure regression fixture",
      requirements: [
        { requirementType: "must_have", name: "TypeScript", weight: 1 },
      ],
      rubricName: "M1 Closure Rubric",
      rubricCriteria: [
        { criterionKey: "system_design", label: "System design", weight: 0.6, required: true, displayOrder: 0 },
        { criterionKey: "reliability", label: "Reliability", weight: 0.4, required: true, displayOrder: 1 },
      ],
    });

    const publishedV1 = await apiJson<{ rubricVersionId: string; version: number }>(
      page,
      organizationId,
      "POST",
      `/v1/jobs/${job.id}/rubric/publish`,
    );
    expect(publishedV1.version).toBe(1);
    expect(publishedV1.rubricVersionId).toBe(job.rubricVersionId);

    const candidate = await apiJson<{ id: string }>(page, organizationId, "POST", "/v1/candidates", {
      displayName: `M1 Candidate ${suffix}`,
      primaryEmail: `m1-${suffix}@example.com`,
      currentRole: "Backend Engineer",
      preferredLanguage: "fa",
    });

    const application = await apiJson<{
      id: string;
      rubricVersionId: string;
      alreadyExisted: boolean;
    }>(page, organizationId, "POST", `/v1/jobs/${job.id}/applications`, {
      candidateId: candidate.id,
      source: "m1-closure-e2e",
      pipelineStage: "new",
    });
    expect(application.alreadyExisted).toBe(false);
    expect(application.rubricVersionId).toBe(publishedV1.rubricVersionId);

    const duplicateApplication = await apiJson<{
      id: string;
      rubricVersionId: string;
      alreadyExisted: boolean;
    }>(page, organizationId, "POST", `/v1/jobs/${job.id}/applications`, {
      candidateId: candidate.id,
      source: "should-not-repin",
    });
    expect(duplicateApplication.id).toBe(application.id);
    expect(duplicateApplication.rubricVersionId).toBe(publishedV1.rubricVersionId);
    expect(duplicateApplication.alreadyExisted).toBe(true);

    const workspaceV1 = await apiJson<{
      rubricCriteria: Array<{ id: string; criterionKey: string }>;
    }>(page, organizationId, "GET", `/v1/jobs/${job.id}/workspace`);
    expect(workspaceV1.rubricCriteria).toHaveLength(2);

    const evidence = await apiJson<{ id: string }>(
      page,
      organizationId,
      "POST",
      `/v1/applications/${application.id}/evidence`,
      {
        evidenceType: "resume_claim",
        sourceType: "manual_e2e",
        sourceReference: `m1:${suffix}`,
        excerpt: "Designed and operated reliable distributed systems.",
      },
    );

    const evaluationIds: string[] = [];
    for (const [index, criterion] of workspaceV1.rubricCriteria.entries()) {
      const evaluation = await apiJson<{ id: string }>(
        page,
        organizationId,
        "POST",
        `/v1/applications/${application.id}/evaluations`,
        {
          criterionId: criterion.id,
          score: index === 0 ? 88 : 82,
          confidence: 0.9,
          rationale: `M1 deterministic human evaluation for ${criterion.criterionKey}`,
          evidenceIds: [evidence.id],
          reviewState: "reviewed",
        },
      );
      evaluationIds.push(evaluation.id);
    }

    const scorecard1 = await apiJson<{
      persisted: boolean;
      scorecardId: string;
      inputFingerprint: string;
      status: string;
    }>(page, organizationId, "POST", `/v1/applications/${application.id}/scorecards/finalize`);
    expect(scorecard1.persisted).toBe(true);
    expect(scorecard1.status).toBe("complete");
    expect(scorecard1.inputFingerprint).toMatch(/^[a-f0-9]{32}$/);

    const scorecardRetry = await apiJson<{
      scorecardId: string;
      inputFingerprint: string;
    }>(page, organizationId, "POST", `/v1/applications/${application.id}/scorecards/finalize`);
    expect(scorecardRetry.scorecardId).toBe(scorecard1.scorecardId);
    expect(scorecardRetry.inputFingerprint).toBe(scorecard1.inputFingerprint);

    const draftV2 = await apiJson<{ rubricVersionId: string; version: number }>(
      page,
      organizationId,
      "PUT",
      `/v1/jobs/${job.id}/rubric/draft`,
      {
        name: "M1 Closure Rubric v2",
        criteria: [
          { criterionKey: "system_design_v2", label: "System design v2", weight: 0.5, required: true, displayOrder: 0 },
          { criterionKey: "operations_v2", label: "Operations v2", weight: 0.5, required: true, displayOrder: 1 },
        ],
      },
    );
    expect(draftV2.version).toBe(2);

    const publishedV2 = await apiJson<{ rubricVersionId: string; version: number }>(
      page,
      organizationId,
      "POST",
      `/v1/jobs/${job.id}/rubric/publish`,
    );
    expect(publishedV2.version).toBe(2);
    expect(publishedV2.rubricVersionId).not.toBe(publishedV1.rubricVersionId);

    const workspaceV2 = await apiJson<{
      rubricCriteria: Array<{ id: string; criterionKey: string }>;
    }>(page, organizationId, "GET", `/v1/jobs/${job.id}/workspace`);
    expect(workspaceV2.rubricCriteria.some((criterion) => criterion.criterionKey === "system_design_v2")).toBe(true);

    await apiJson<unknown>(
      page,
      organizationId,
      "POST",
      `/v1/applications/${application.id}/evaluations`,
      {
        criterionId: workspaceV2.rubricCriteria[0]!.id,
        score: 99,
        rationale: "This must be rejected because the application is pinned to v1.",
        evidenceIds: [evidence.id],
      },
      400,
    );

    const scorecardAfterV2 = await apiJson<{ scorecardId: string; inputFingerprint: string }>(
      page,
      organizationId,
      "POST",
      `/v1/applications/${application.id}/scorecards/finalize`,
    );
    expect(scorecardAfterV2.scorecardId).toBe(scorecard1.scorecardId);
    expect(scorecardAfterV2.inputFingerprint).toBe(scorecard1.inputFingerprint);

    await apiJson(
      page,
      organizationId,
      "POST",
      `/v1/scorecards/${scorecard1.scorecardId}/reviews`,
      {
        reviewState: "approved",
        reason: "M1 closure human review approved the evidence-backed scorecard.",
      },
    );

    await apiJson(
      page,
      organizationId,
      "POST",
      `/v1/applications/${application.id}/decision`,
      {
        decision: "hold",
        reason: "M1 closure verifies the final decision remains human controlled.",
        scorecardId: scorecard1.scorecardId,
      },
    );

    await page.reload();

    const candidateWorkspace = await apiJson<{
      applications: Array<{ id: string; rubricVersionId: string }>;
    }>(page, organizationId, "GET", `/v1/candidates/${candidate.id}/workspace`);
    const persistedApplication = candidateWorkspace.applications.find((item) => item.id === application.id);
    expect(persistedApplication?.rubricVersionId).toBe(publishedV1.rubricVersionId);

    const decisionSupport = await apiJson<{
      application: { rubric_version_id: string };
      scorecards: Array<{ id: string; rubric_version_id: string; input_fingerprint: string }>;
      scorecardInputs: Array<{
        scorecard_id: string;
        criterion_evaluation_id: string;
        evidence_ids: string[];
      }>;
      decisions: Array<{ decision: string; scorecard_id: string }>;
    }>(page, organizationId, "GET", `/v1/applications/${application.id}/decision-support`);

    expect(decisionSupport.application.rubric_version_id).toBe(publishedV1.rubricVersionId);
    expect(decisionSupport.scorecards).toHaveLength(1);
    expect(decisionSupport.scorecards[0]?.rubric_version_id).toBe(publishedV1.rubricVersionId);
    expect(decisionSupport.scorecards[0]?.input_fingerprint).toBe(scorecard1.inputFingerprint);
    expect(decisionSupport.scorecardInputs).toHaveLength(2);
    expect(new Set(decisionSupport.scorecardInputs.map((input) => input.criterion_evaluation_id))).toEqual(
      new Set(evaluationIds),
    );
    expect(decisionSupport.scorecardInputs.every((input) => input.evidence_ids.includes(evidence.id))).toBe(true);
    expect(decisionSupport.decisions.some((decision) => decision.decision === "hold" && decision.scorecard_id === scorecard1.scorecardId)).toBe(true);
  });
});

import assert from "node:assert/strict";
import test from "node:test";
import { InterviewsService } from "./interviews.service";

const organizationId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const applicationId = "33333333-3333-4333-8333-333333333333";
const candidateId = "44444444-4444-4444-8444-444444444444";
const jobId = "55555555-5555-4555-8555-555555555555";
const rubricVersionId = "66666666-6666-4666-8666-666666666666";

test("interview review scopes resume claims to the current application", async () => {
  let resumeQueryChecked = false;

  const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join(" ");

    if (query.includes("FROM interview_sessions s") && query.includes("JOIN interview_release_units")) {
      return [{
        id: sessionId,
        status: "in_progress",
        application_id: applicationId,
        current_criterion_key: null,
        remaining_seconds: 1100,
        reconnect_count: 0,
        started_at: new Date(Date.now() - 60_000).toISOString(),
        completed_at: null,
        plan_id: "77777777-7777-4777-8777-777777777777",
        plan_version: 1,
        language: "fa",
        interview_type: "ai_technical",
        time_budget_minutes: 20,
        rubric_version_id: rubricVersionId,
        lifecycle_stage: "development",
        interviewer_policy_version: "test",
        speech_avatar_stack_version: "test",
        evaluator_version: "test",
        candidate_id: candidateId,
        job_id: jobId,
      }];
    }

    if (query.includes("FROM evidence") && query.includes("candidate_id")) {
      resumeQueryChecked = true;
      assert.match(query, /application_id IS NULL/);
      assert.match(query, /OR application_id=/);
      assert.ok(values.map(String).includes(applicationId));
      return [];
    }

    return [];
  };

  const service = new InterviewsService(
    { sql } as never,
    { require: () => ({ organizationId }) } as never,
    {} as never,
  );

  const review = await service.getReview(sessionId);

  assert.ok(review);
  assert.equal(String(review.session.application_id), applicationId);
  assert.equal(resumeQueryChecked, true);
});

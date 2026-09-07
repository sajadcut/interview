import assert from "node:assert/strict";
import test from "node:test";
import type { DatabaseService } from "../database/database.service";
import type { TenantContextService } from "../tenant/tenant-context.service";
import { InterviewBrainService } from "./interview-brain.service";
import { LlmInterviewerFailure, type ConversationalInterviewerTrace } from "./llm-interviewer.service";

const organizationId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const jobId = "33333333-3333-4333-8333-333333333333";
const rubricVersionId = "44444444-4444-4444-8444-444444444444";
const insertedTurnId = "55555555-5555-4555-8555-555555555555";

interface HarnessResult {
  service: InterviewBrainService;
  getInsert: () => { query: string; values: unknown[] } | null;
  getCheckpoint: () => Record<string, unknown> | null;
}

function harness(options: {
  llmTurn?: Record<string, unknown>;
  llmFailure?: string;
  forbiddenTopics?: string[];
} = {}): HarnessResult {
  let inserted: { query: string; values: unknown[] } | null = null;
  let checkpoint: Record<string, unknown> | null = null;

  const transaction = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join(" ");
    if (query.includes("FROM interview_sessions s") && query.includes("JOIN interview_plans p")) {
      return [{
        id: sessionId,
        status: "in_progress",
        current_criterion_key: "backend_depth",
        remaining_seconds: 1200,
        reconnect_count: 0,
        checkpoint: { candidateIsRealCustomerCandidate: false },
        job_id: jobId,
        rubric_version_id: rubricVersionId,
        plan_version: 3,
        language: "fa",
        interview_type: "structured",
        time_budget_minutes: 30,
        question_strategy: {
          requiredCriteria: ["backend_depth"],
          criteria: {
            backend_depth: {
              spokenLabel: "مهندسی بک‌اند",
              objective: "validate production backend depth",
              expectedEvidence: ["technical decision", "trade-offs", "measurable outcome"],
            },
          },
        },
        forbidden_topics: options.forbiddenTopics ?? [],
        job_title: "Senior Backend Engineer",
        job_department: "Engineering",
        job_seniority: "Senior",
        job_summary: "Backend platform role",
        lifecycle_stage: "INTERNAL_TEST",
        production_approved_at: null,
        production_approved_by_user_id: null,
      }];
    }
    if (query.includes("FROM rubric_criteria")) {
      return [{
        criterion_key: "backend_depth",
        label: "Backend engineering",
        description: "validate production backend depth",
        evidence_policy: { minimumEvidence: 1 },
        display_order: 0,
      }];
    }
    if (query.includes("FROM interview_evidence e")) return [];
    if (query.includes("FROM interview_turns")) {
      return [{
        sequence: 0,
        criterion_key: "backend_depth",
        action: "ask",
        objective: "validate production backend depth",
        spoken_text: "درباره یک تجربه واقعی در بک‌اند توضیح بدید.",
      }];
    }
    if (query.includes("FROM interview_transcript_segments")) {
      return [
        { speaker: "candidate", text: "نتیجه هیچی نشد" },
        { speaker: "interviewer", text: "درباره یک تجربه واقعی در بک‌اند توضیح بدید." },
      ];
    }
    if (query.includes("FROM job_requirements")) return [];
    if (query.includes("INSERT INTO interview_turns")) {
      inserted = { query, values };
      return [{ id: insertedTurnId, created_at: new Date("2026-09-07T12:00:00.000Z") }];
    }
    if (query.includes("UPDATE interview_sessions")) {
      checkpoint = values.find(
        (value): value is Record<string, unknown> =>
          Boolean(value && typeof value === "object" && !Array.isArray(value) && "brain" in value),
      ) ?? null;
      return [];
    }
    throw new Error(`Unexpected Interview Brain SQL in unit test: ${query.replace(/\s+/g, " ").trim()}`);
  };

  const sql = Object.assign(
    async () => {
      throw new Error("Interview Brain test expected a transaction");
    },
    {
      begin: async <T>(callback: (tx: typeof transaction) => Promise<T>) => callback(transaction),
      json: (value: unknown) => value,
    },
  );
  const database = { sql } as unknown as DatabaseService;
  const tenant = { require: () => ({ organizationId }) } as TenantContextService;

  const defaultTurn = {
    action: "probe",
    criterion: "backend_depth",
    objective: "validate production backend depth",
    spokenText: "وقتی می‌گید نتیجه‌ای نگرفتید، دقیقاً چه چیزی اثر نکرد و بعد از دیدنش چه تصمیمی گرفتید؟",
    expectedEvidence: ["technical decision"],
    reason: "Clarify the failed outcome and the candidate's next decision.",
  };
  const trace: ConversationalInterviewerTrace = {
    mode: "llm",
    provider: "openai-compatible",
    model: "test-model",
    promptId: "interview.conversational_next_turn",
    promptVersion: "v1",
    reason: String((options.llmTurn ?? defaultTurn).reason ?? "grounded follow-up"),
    executionId: "execution-1",
  };
  const llm = {
    generateTurn: async () => {
      if (options.llmFailure) throw new LlmInterviewerFailure(options.llmFailure);
      const value = options.llmTurn ?? defaultTurn;
      return {
        turn: {
          action: value.action,
          criterion: value.criterion,
          objective: value.objective,
          spokenText: value.spokenText,
          expectedEvidence: value.expectedEvidence,
        },
        trace,
      };
    },
    readiness: async () => ({
      enabled: true,
      configured: true,
      reachable: true,
      ready: true,
      provider: "openai-compatible",
      promptId: "interview.conversational_next_turn",
      promptVersion: "v1",
      fallbackAvailable: true,
    }),
  };

  return {
    service: new InterviewBrainService(database, tenant, llm as never),
    getInsert: () => inserted,
    getCheckpoint: () => checkpoint,
  };
}

test("healthy LLM follow-up is policy-checked, finalized, traced and does not manufacture evidence", async () => {
  const testHarness = harness();
  const result = await testHarness.service.nextTurn(sessionId, {
    latestCandidateText: "نتیجه هیچی نشد",
    candidateIntent: "ANSWER",
    elapsedSeconds: 4,
  });

  assert.equal(result.brainMode, "llm");
  assert.equal(result.brainProvider, "openai-compatible");
  assert.equal(result.brainPromptId, "interview.conversational_next_turn");
  assert.equal(result.brainPromptVersion, "v1");
  assert.equal(result.finalized, true);
  assert.match(result.spokenText, /نتیجه‌ای نگرفتید|اثر نکرد/);
  assert.doesNotMatch(result.spokenText, /ممنون\. برای ارزیابی دقیق‌تر/);
  assert.deepEqual(result.evidenceCoverage, {});

  const inserted = testHarness.getInsert();
  assert.ok(inserted);
  assert.match(inserted.query, /interviewer_trace_reference, finalized/);
  assert.match(inserted.query, /true/);
  assert.ok(inserted.values.some((value) => typeof value === "string" && value.startsWith("llm:openai-compatible:v1:")));

  const checkpoint = testHarness.getCheckpoint();
  assert.ok(checkpoint);
  const brain = checkpoint.brain as Record<string, unknown>;
  assert.equal(brain.mode, "llm");
  assert.equal(brain.provider, "openai-compatible");
  assert.deepEqual(brain.evidenceCoverage, {});
});

test("policy rejection of an LLM question falls back deterministically without crashing the interview", async () => {
  const testHarness = harness({
    forbiddenTopics: ["سن"],
    llmTurn: {
      action: "probe",
      criterion: "backend_depth",
      objective: "validate production backend depth",
      spokenText: "سن شما چند سال است؟",
      expectedEvidence: ["technical decision"],
      reason: "unsafe off-plan probe",
    },
  });
  const result = await testHarness.service.nextTurn(sessionId, {
    latestCandidateText: "نتیجه هیچی نشد",
    candidateIntent: "ANSWER",
    elapsedSeconds: 4,
  });

  assert.equal(result.brainMode, "deterministic_fallback");
  assert.match(result.brainFallbackReason, /^policy_rejection:/);
  assert.equal(result.finalized, true);
  assert.doesNotMatch(result.spokenText, /سن شما/);
  const checkpoint = testHarness.getCheckpoint();
  assert.ok(checkpoint);
  const policy = checkpoint.policy as Record<string, unknown>;
  assert.ok(Array.isArray(policy.rejectedLlmViolations));
  assert.ok((policy.rejectedLlmViolations as unknown[]).includes("forbidden_topic"));
});

test("provider timeout becomes a fast deterministic fallback and still persists a finalized turn", async () => {
  const testHarness = harness({ llmFailure: "PROVIDER_TIMEOUT" });
  const result = await testHarness.service.nextTurn(sessionId, {
    latestCandidateText: "نتیجه هیچی نشد",
    candidateIntent: "ANSWER",
    elapsedSeconds: 4,
  });

  assert.equal(result.brainMode, "deterministic_fallback");
  assert.equal(result.brainFallbackReason, "PROVIDER_TIMEOUT");
  assert.equal(result.finalized, true);
  const inserted = testHarness.getInsert();
  assert.ok(inserted?.values.some(
    (value) => typeof value === "string" && value.startsWith("deterministic_fallback:PROVIDER_TIMEOUT:"),
  ));
});

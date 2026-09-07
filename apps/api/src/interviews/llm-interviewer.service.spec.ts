import assert from "node:assert/strict";
import test from "node:test";
import type { AiGatewayService } from "../ai/ai-gateway.service";
import { RealtimeAiExecutionError } from "../ai/ai-gateway.service";
import {
  LlmInterviewerFailure,
  LlmInterviewerService,
  type ConversationalInterviewerContext,
} from "./llm-interviewer.service";

function context(): ConversationalInterviewerContext {
  return {
    sessionId: "11111111-1111-4111-8111-111111111111",
    sequence: 1,
    language: "fa",
    latestCandidateText: "نتیجه هیچی نشد",
    candidateIntent: "ANSWER",
    currentCriterion: "backend_depth",
    remainingSeconds: 1200,
    criteria: [
      {
        key: "backend_depth",
        label: "Backend engineering",
        spokenLabel: "مهندسی بک‌اند",
        objective: "validate production backend depth",
        expectedEvidence: ["technical decision", "trade-offs", "outcome"],
        minimumEvidence: 1,
        evidenceCount: 0,
      },
      {
        key: "system_design",
        label: "System design",
        spokenLabel: "طراحی سیستم",
        objective: "validate system design",
        expectedEvidence: ["requirements", "trade-offs"],
        minimumEvidence: 1,
        evidenceCount: 0,
      },
    ],
    evidenceGaps: ["backend_depth", "system_design"],
    recentTranscript: [
      { speaker: "interviewer", text: "درباره یک تجربه واقعی بک‌اند توضیح دهید." },
      { speaker: "candidate", text: "نتیجه هیچی نشد" },
    ],
    job: { title: "Senior Backend Engineer", requirements: [] },
    plan: { version: 1, interviewType: "structured", timeBudgetMinutes: 30 },
    deterministicRecommendation: {
      action: "probe",
      criterion: "backend_depth",
      objective: "validate production backend depth",
      expectedEvidence: ["technical decision"],
    },
    closeObjectives: ["respect_time_budget", "complete_evidence_coverage"],
  };
}

function serviceWithOutput(output: Record<string, unknown>) {
  const ai = {
    executeStructured: async () => ({
      executionId: "execution-1",
      output,
      provenance: {
        provider: "openai-compatible",
        model: "test-model",
        promptId: "interview.conversational_next_turn",
        promptVersion: "v1",
      },
    }),
    realtimeReadiness: async () => ({
      enabled: true,
      configured: true,
      reachable: true,
      ready: true,
      provider: "openai-compatible",
    }),
  } as unknown as AiGatewayService;
  return new LlmInterviewerService(ai);
}

test("LLM interviewer accepts a grounded Persian conversational follow-up with trace metadata", async () => {
  const service = serviceWithOutput({
    action: "probe",
    criterion: "backend_depth",
    objective: "validate production backend depth",
    spokenText: "وقتی می‌گید نتیجه‌ای نگرفتید، دقیقاً چه چیزی اثر نکرد و بعدش چه تصمیمی گرفتید؟",
    expectedEvidence: ["technical decision"],
    reason: "The candidate's outcome is ambiguous; ask about the failure and next decision.",
  });
  const result = await service.generateTurn(context());
  assert.equal(result.turn.action, "probe");
  assert.match(result.turn.spokenText, /نتیجه|اثر نکرد/);
  assert.doesNotMatch(result.turn.spokenText, /ممنون\. برای ارزیابی دقیق‌تر/);
  assert.equal(result.trace.mode, "llm");
  assert.equal(result.trace.provider, "openai-compatible");
  assert.equal(result.trace.promptVersion, "v1");
});

test("LLM interviewer rejects near-duplicate questions", async () => {
  const input = context();
  const service = serviceWithOutput({
    action: "probe",
    criterion: "backend_depth",
    objective: "validate production backend depth",
    spokenText: "درباره یک تجربه واقعی بک‌اند توضیح دهید.",
    expectedEvidence: ["technical decision"],
    reason: "repeat",
  });
  await assert.rejects(
    () => service.generateTurn(input),
    (error) => error instanceof LlmInterviewerFailure && error.code === "duplicate_question",
  );
});

test("LLM interviewer cannot transition away from a criterion before persisted evidence covers it", async () => {
  const service = serviceWithOutput({
    action: "transition",
    criterion: "system_design",
    objective: "validate system design",
    spokenText: "بریم سراغ طراحی سیستم.",
    expectedEvidence: [],
    reason: "move on",
  });
  await assert.rejects(
    () => service.generateTurn(context()),
    (error) => error instanceof LlmInterviewerFailure && error.code === "progression_outside_evidence_state",
  );
});

test("LLM interviewer accepts a transition only when deterministic evidence state recommends the next criterion", async () => {
  const input = context();
  input.criteria[0]!.evidenceCount = 1;
  input.deterministicRecommendation = {
    action: "ask",
    criterion: "system_design",
    objective: "validate system design",
    expectedEvidence: ["requirements"],
  };
  const service = serviceWithOutput({
    action: "transition",
    criterion: "system_design",
    objective: "validate system design",
    spokenText: "خوبه، حالا روی طراحی سیستم تمرکز کنیم: در یکی از سیستم‌هایی که طراحی کردید مهم‌ترین محدودیت چه بود؟",
    expectedEvidence: [],
    reason: "Persisted evidence covers the previous criterion, so transition to the next gap.",
  });
  const result = await service.generateTurn(input);
  assert.equal(result.turn.action, "transition");
  assert.equal(result.turn.criterion, "system_design");
});

test("LLM interviewer may close conversationally only after deterministic state authorizes closing", async () => {
  const input = context();
  input.criteria[0]!.evidenceCount = 1;
  input.criteria[1]!.evidenceCount = 1;
  input.evidenceGaps = [];
  input.deterministicRecommendation = {
    action: "close",
    criterion: null,
    objective: "complete_evidence_coverage",
    expectedEvidence: [],
  };
  const service = serviceWithOutput({
    action: "close",
    criterion: null,
    objective: "complete_evidence_coverage",
    spokenText: "بخش‌های لازم را پوشش دادیم و مصاحبه را همین‌جا به پایان می‌رسونیم.",
    expectedEvidence: [],
    reason: "Persisted evidence coverage is complete.",
  });
  const result = await service.generateTurn(input);
  assert.equal(result.turn.action, "close");
  assert.equal(result.turn.criterion, null);
});

test("LLM interviewer rejects close turns that retain a criterion key", async () => {
  const input = context();
  input.deterministicRecommendation = {
    action: "close",
    criterion: null,
    objective: "complete_evidence_coverage",
    expectedEvidence: [],
  };
  const service = serviceWithOutput({
    action: "close",
    criterion: "backend_depth",
    objective: "complete_evidence_coverage",
    spokenText: "مصاحبه را همین‌جا به پایان می‌رسونیم.",
    expectedEvidence: [],
    reason: "close",
  });
  await assert.rejects(
    () => service.generateTurn(input),
    (error) => error instanceof LlmInterviewerFailure && error.code === "close_criterion_must_be_null",
  );
});

test("invalid structured output fails closed before policy or persistence", async () => {
  const service = serviceWithOutput({
    action: "probe",
    criterion: "backend_depth",
    spokenText: "missing objective and evidence",
    reason: "invalid",
  });
  await assert.rejects(
    () => service.generateTurn(context()),
    (error) => error instanceof LlmInterviewerFailure && error.code === "invalid_structured_output",
  );
});

test("provider failures become stable fallback reasons", async () => {
  const ai = {
    executeStructured: async () => {
      throw new RealtimeAiExecutionError("PROVIDER_TIMEOUT", { retryable: true });
    },
  } as unknown as AiGatewayService;
  const service = new LlmInterviewerService(ai);
  await assert.rejects(
    () => service.generateTurn(context()),
    (error) => error instanceof LlmInterviewerFailure && error.code === "PROVIDER_TIMEOUT",
  );
});

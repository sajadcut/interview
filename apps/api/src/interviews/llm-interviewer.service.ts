import { Injectable } from "@nestjs/common";
import {
  AiGatewayService,
  RealtimeAiExecutionError,
  type AiRealtimeProvenance,
} from "../ai/ai-gateway.service";
import {
  InterviewActions,
  validateStructuredInterviewTurn,
  type StructuredInterviewTurn,
} from "./interview-contracts";

export const LLM_INTERVIEWER_CONTRACT_VERSION = "llm-interviewer.v1";
export const LLM_INTERVIEWER_CAPABILITY_VERSION = "v2";
export const LLM_INTERVIEWER_PROMPT_ID = "interview.conversational_next_turn";
export const LLM_INTERVIEWER_PROMPT_VERSION = "v2";
export const LLM_INTERVIEWER_SCHEMA_VERSION = "llm-interviewer.v1";

export interface ConversationalCriterionContext {
  key: string;
  label: string;
  spokenLabel?: string;
  objective: string;
  expectedEvidence: string[];
  minimumEvidence: number;
  evidenceCount: number;
}

export interface ConversationalTranscriptTurn {
  speaker: "candidate" | "interviewer";
  text: string;
}

export interface ConversationalInterviewerContext {
  sessionId: string;
  sequence: number;
  language: string;
  latestCandidateText: string;
  candidateIntent: string | null;
  currentCriterion: string | null;
  remainingSeconds: number;
  criteria: ConversationalCriterionContext[];
  evidenceGaps: string[];
  recentTranscript: ConversationalTranscriptTurn[];
  job: {
    title: string;
    department?: string;
    seniority?: string;
    summary?: string;
    requirements: Array<{ type: string; name: string; description?: string }>;
  };
  plan: {
    version: number;
    interviewType: string;
    timeBudgetMinutes: number;
  };
  deterministicRecommendation: {
    action: string;
    criterion: string | null;
    objective: string;
    expectedEvidence: string[];
  };
  closeObjectives: string[];
}

interface ConversationalInterviewerModelContext extends ConversationalInterviewerContext {
  previousInterviewerQuestion: string | null;
  evidenceCoverage: Record<string, number>;
}

export interface ConversationalInterviewerTrace {
  mode: "llm";
  provider: string;
  model?: string;
  promptId: string;
  promptVersion: string;
  reason: string;
  executionId: string;
}

export class LlmInterviewerFailure extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`LLM interviewer failed: ${code}`);
    this.name = "LlmInterviewerFailure";
    this.code = code;
  }
}

function boundedTimeoutMs(): number {
  const parsed = Number(process.env.AI_INTERVIEWER_REQUEST_TIMEOUT_MS ?? 12_000);
  return Number.isFinite(parsed) ? Math.max(500, Math.min(30_000, Math.trunc(parsed))) : 12_000;
}

function normalizedText(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSimilarity(left: string, right: string): number {
  const leftTokens = new Set(normalizedText(left).split(" ").filter(Boolean));
  const rightTokens = new Set(normalizedText(right).split(" ").filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let intersection = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) intersection += 1;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union ? intersection / union : 0;
}

function buildModelContext(context: ConversationalInterviewerContext): ConversationalInterviewerModelContext {
  const previousInterviewerQuestion = [...context.recentTranscript]
    .reverse()
    .find((item) => item.speaker === "interviewer")?.text.trim() || null;
  const evidenceCoverage = Object.fromEntries(
    context.criteria.map((criterion) => [criterion.key, Math.max(0, criterion.evidenceCount)]),
  );
  return {
    ...context,
    previousInterviewerQuestion,
    evidenceCoverage,
  };
}

function parseOutput(value: unknown): { turn: StructuredInterviewTurn; reason: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new LlmInterviewerFailure("invalid_structured_output");
  const row = value as Record<string, unknown>;
  if (typeof row.action !== "string" || !InterviewActions.includes(row.action as StructuredInterviewTurn["action"])) {
    throw new LlmInterviewerFailure("invalid_structured_output");
  }
  if (!["ask", "probe", "clarify", "transition", "close"].includes(row.action)) {
    throw new LlmInterviewerFailure("unsupported_conversational_action");
  }
  if (row.criterion !== null && typeof row.criterion !== "string") throw new LlmInterviewerFailure("invalid_structured_output");
  if (typeof row.objective !== "string" || typeof row.spokenText !== "string" || typeof row.reason !== "string") {
    throw new LlmInterviewerFailure("invalid_structured_output");
  }
  if (!Array.isArray(row.expectedEvidence) || !row.expectedEvidence.every((item) => typeof item === "string")) {
    throw new LlmInterviewerFailure("invalid_structured_output");
  }
  const criterion = typeof row.criterion === "string" && row.criterion.trim() ? row.criterion.trim() : null;
  const turn: StructuredInterviewTurn = {
    action: row.action as StructuredInterviewTurn["action"],
    criterion,
    objective: row.objective.trim(),
    spokenText: row.spokenText.trim(),
    expectedEvidence: (row.expectedEvidence as string[]).map((item) => item.trim()).filter(Boolean),
  };
  const reason = row.reason.trim();
  if (!reason || reason.length > 500 || turn.spokenText.length > 1200) {
    throw new LlmInterviewerFailure("invalid_structured_output");
  }
  try {
    validateStructuredInterviewTurn(turn);
  } catch {
    throw new LlmInterviewerFailure("invalid_structured_output");
  }
  return { turn, reason };
}

function validateAgainstContext(turn: StructuredInterviewTurn, context: ConversationalInterviewerContext): void {
  const criterion = turn.criterion
    ? context.criteria.find((item) => item.key === turn.criterion)
    : undefined;
  if (turn.criterion && !criterion) throw new LlmInterviewerFailure("criterion_outside_plan");
  if (["ask", "probe", "transition"].includes(turn.action) && !criterion) {
    throw new LlmInterviewerFailure("criterion_required");
  }
  if (turn.action === "close" && turn.criterion !== null) {
    throw new LlmInterviewerFailure("close_criterion_must_be_null");
  }
  if (criterion && ["ask", "probe", "clarify", "transition"].includes(turn.action) && turn.objective !== criterion.objective) {
    throw new LlmInterviewerFailure("objective_outside_plan");
  }
  if (criterion && ["ask", "probe"].includes(turn.action)) {
    const allowedEvidence = new Set(criterion.expectedEvidence.map(normalizedText));
    if (turn.expectedEvidence.some((item) => !allowedEvidence.has(normalizedText(item)))) {
      throw new LlmInterviewerFailure("expected_evidence_outside_criterion");
    }
  }

  const recommended = context.deterministicRecommendation;
  const current = context.currentCriterion
    ? context.criteria.find((item) => item.key === context.currentCriterion)
    : undefined;
  const currentCovered = Boolean(current && current.evidenceCount >= current.minimumEvidence);
  if (recommended.action === "probe") {
    if (!["probe", "clarify"].includes(turn.action) || turn.criterion !== recommended.criterion) {
      throw new LlmInterviewerFailure("progression_outside_evidence_state");
    }
  } else if (recommended.action === "ask") {
    const movingToNextCriterion = Boolean(
      context.currentCriterion && recommended.criterion !== context.currentCriterion,
    );
    const allowed = movingToNextCriterion && currentCovered ? ["ask", "transition"] : ["ask", "clarify"];
    if (!allowed.includes(turn.action) || turn.criterion !== recommended.criterion) {
      throw new LlmInterviewerFailure("progression_outside_evidence_state");
    }
  } else if (recommended.action === "close") {
    if (turn.action !== "close") throw new LlmInterviewerFailure("close_required");
  } else if (turn.action !== recommended.action || turn.criterion !== recommended.criterion) {
    throw new LlmInterviewerFailure("progression_outside_evidence_state");
  }

  if (turn.action === "close" && !context.closeObjectives.includes(turn.objective)) {
    throw new LlmInterviewerFailure("close_not_authorized");
  }
  const recentInterviewer = context.recentTranscript
    .filter((item) => item.speaker === "interviewer")
    .slice(-6);
  const normalized = normalizedText(turn.spokenText);
  for (const prior of recentInterviewer) {
    if (normalized === normalizedText(prior.text) || tokenSimilarity(turn.spokenText, prior.text) >= 0.9) {
      throw new LlmInterviewerFailure("duplicate_question");
    }
  }
}

function traceFrom(
  executionId: string,
  provenance: AiRealtimeProvenance,
  reason: string,
): ConversationalInterviewerTrace {
  return {
    mode: "llm",
    provider: provenance.provider,
    ...(provenance.model ? { model: provenance.model } : {}),
    promptId: provenance.promptId,
    promptVersion: provenance.promptVersion,
    reason,
    executionId,
  };
}

@Injectable()
export class LlmInterviewerService {
  constructor(private readonly ai: AiGatewayService) {}

  async generateTurn(context: ConversationalInterviewerContext): Promise<{
    turn: StructuredInterviewTurn;
    trace: ConversationalInterviewerTrace;
  }> {
    try {
      const modelContext = buildModelContext(context);
      const result = await this.ai.executeStructured<Record<string, unknown>>({
        capability: "interview.next_turn",
        capabilityVersion: LLM_INTERVIEWER_CAPABILITY_VERSION,
        promptId: LLM_INTERVIEWER_PROMPT_ID,
        promptVersion: LLM_INTERVIEWER_PROMPT_VERSION,
        structuredOutputSchemaVersion: LLM_INTERVIEWER_SCHEMA_VERSION,
        input: modelContext as unknown as Record<string, unknown>,
        inputReferences: {
          sessionId: context.sessionId,
          sequence: context.sequence,
          currentCriterion: context.currentCriterion,
        },
        idempotencyKey: `realtime-interviewer:${context.sessionId}:${context.sequence}`,
        timeoutMs: boundedTimeoutMs(),
      });
      const parsed = parseOutput(result.output);
      validateAgainstContext(parsed.turn, context);
      return {
        turn: parsed.turn,
        trace: traceFrom(result.executionId, result.provenance, parsed.reason),
      };
    } catch (cause) {
      if (cause instanceof LlmInterviewerFailure) throw cause;
      if (cause instanceof RealtimeAiExecutionError) throw new LlmInterviewerFailure(cause.code);
      throw new LlmInterviewerFailure("unexpected_provider_failure");
    }
  }

  async readiness() {
    const readiness = await this.ai.realtimeReadiness();
    return {
      contractVersion: LLM_INTERVIEWER_CONTRACT_VERSION,
      ...readiness,
      fallbackAvailable: true,
      promptId: readiness.promptId ?? LLM_INTERVIEWER_PROMPT_ID,
      promptVersion: readiness.promptVersion ?? LLM_INTERVIEWER_PROMPT_VERSION,
    };
  }
}

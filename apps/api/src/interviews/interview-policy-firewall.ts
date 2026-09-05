import {
  CandidateIntents,
  InterviewActions,
  validateStructuredInterviewTurn,
  type CandidateIntent,
  type StructuredInterviewTurn,
} from "./interview-contracts";

export const INTERVIEW_POLICY_FIREWALL_VERSION = "interview-policy-firewall-v1";

export interface InterviewPolicyCriterion {
  key: string;
  objective: string;
}

export interface InterviewPolicyPriorTurn {
  action: string;
  criterion: string | null;
  objective?: string | null;
  spokenText: string;
}

export interface InterviewPolicyContext {
  criteria: InterviewPolicyCriterion[];
  forbiddenTopics: unknown;
  priorTurns: InterviewPolicyPriorTurn[];
  remainingSeconds: number;
  candidateIntent: CandidateIntent | null;
  latestCandidateText?: string;
}

export interface InterviewPolicyResult {
  decision: "accepted" | "fallback";
  turn: StructuredInterviewTurn;
  violations: string[];
  policyVersion: typeof INTERVIEW_POLICY_FIREWALL_VERSION;
}

export class InterviewPolicyViolation extends Error {
  readonly violations: string[];

  constructor(violations: string[]) {
    super(`Interview turn rejected by policy: ${violations.join(", ")}`);
    this.name = "InterviewPolicyViolation";
    this.violations = violations;
  }
}

const OPERATIONAL_OBJECTIVES = new Set([
  "recover_after_reconnect",
  "recover_from_silence",
  "respect_candidate_skip_or_refusal",
  "respect_candidate_end_request",
  "route_candidate_factual_question",
  "respect_time_budget",
  "complete_evidence_coverage",
  "end_session_without_configured_criteria",
  "enforce_abuse_boundary",
  "policy_violation_human_review",
]);

const CONTROL_LEAK_PATTERNS = [
  /\bsystem prompt\b/i,
  /\bdeveloper (?:message|instructions?)\b/i,
  /\bgrading criteria\b/i,
  /\bscoring criteria\b/i,
  /\brubric (?:is|says|requires|weights?)\b/i,
  /\bcorrect answer (?:is|would be)\b/i,
  /\bideal answer (?:is|would be)\b/i,
  /\bto (?:get|receive) full (?:marks|credit)\b/i,
  /\bsay exactly\b/i,
  /معیار(?:های)? نمره/i,
  /پاسخ درست/i,
  /پاسخ ایده.?آل/i,
  /دستور(?:های)? سیستم/i,
];

const FABRICATION_PATTERNS = [
  /\btreat (?:this|that) as evidence\b/i,
  /\bassume (?:the )?candidate (?:said|did|knows)\b/i,
  /\bfabricat(?:e|ed|ing) evidence\b/i,
  /\bmark (?:the )?(?:criterion|evidence) as (?:met|complete)\b/i,
  /مدرک .*فرض/i,
  /فرض کن .*گفته/i,
];

function normalizedText(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function forbiddenTopicLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const labels: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim().length >= 3) labels.push(item.trim());
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const record = item as Record<string, unknown>;
      for (const key of ["topic", "label", "key", "name"]) {
        if (typeof record[key] === "string" && String(record[key]).trim().length >= 3) {
          labels.push(String(record[key]).trim());
        }
      }
    }
  }
  return [...new Set(labels.map(normalizedText))];
}

function parseTurn(value: unknown): StructuredInterviewTurn | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.action !== "string" || !InterviewActions.includes(record.action as StructuredInterviewTurn["action"])) {
    return null;
  }
  if (record.criterion !== null && typeof record.criterion !== "string") return null;
  if (typeof record.objective !== "string" || typeof record.spokenText !== "string") return null;
  if (!Array.isArray(record.expectedEvidence) || !record.expectedEvidence.every((item) => typeof item === "string")) {
    return null;
  }
  return {
    action: record.action as StructuredInterviewTurn["action"],
    criterion: record.criterion === null ? null : String(record.criterion),
    objective: record.objective,
    spokenText: record.spokenText,
    expectedEvidence: record.expectedEvidence as string[],
  };
}

function intentViolations(intent: CandidateIntent | null, turn: StructuredInterviewTurn): string[] {
  if (!intent) return [];
  if (!CandidateIntents.includes(intent)) return ["unsupported_candidate_intent"];
  switch (intent) {
    case "END_INTERVIEW_REQUEST":
      return turn.action === "close" ? [] : ["candidate_end_request_not_respected"];
    case "SKIP_REQUEST":
    case "POLICY_REFUSAL":
      return turn.action === "transition" || turn.action === "close"
        ? []
        : ["candidate_skip_or_refusal_not_respected"];
    case "CLARIFICATION_REQUEST":
    case "INTERRUPTION":
    case "SILENCE_TIMEOUT":
    case "RECONNECT":
      return turn.action === "clarify" || turn.action === "close"
        ? []
        : ["recovery_intent_requires_deterministic_recovery"];
    case "CANDIDATE_QUESTION":
      return turn.action === "escalate" || turn.action === "close"
        ? []
        : ["candidate_question_must_use_approved_information_flow"];
    case "ABUSIVE_INPUT":
      return (turn.action === "clarify" || turn.action === "close") &&
        OPERATIONAL_OBJECTIVES.has(turn.objective)
        ? []
        : ["abusive_input_requires_safe_boundary"];
    default:
      return [];
  }
}

export function interviewTurnPolicyViolations(
  rawTurn: unknown,
  context: InterviewPolicyContext,
): string[] {
  const turn = parseTurn(rawTurn);
  if (!turn) return ["invalid_model_output"];

  const violations: string[] = [];
  try {
    validateStructuredInterviewTurn(turn);
  } catch {
    violations.push("invalid_structured_turn");
  }

  const criteria = new Map(context.criteria.map((criterion) => [criterion.key, criterion]));
  const criterion = turn.criterion ? criteria.get(turn.criterion) : undefined;
  const evidenceSeeking = turn.action === "ask" || turn.action === "probe";

  if (turn.criterion && !criterion) violations.push("criterion_outside_plan_rubric");
  if ((evidenceSeeking || turn.action === "transition") && !turn.criterion) {
    violations.push("criterion_required_for_job_relevant_turn");
  }
  if (evidenceSeeking && criterion && turn.objective !== criterion.objective) {
    violations.push("objective_outside_interview_plan");
  }
  if (
    !evidenceSeeking &&
    turn.objective &&
    !OPERATIONAL_OBJECTIVES.has(turn.objective) &&
    (!criterion || turn.objective !== criterion.objective)
  ) {
    violations.push("objective_outside_interview_plan");
  }

  if (context.remainingSeconds <= 60 && turn.action !== "close") {
    violations.push("time_budget_exhausted");
  }

  const spoken = normalizedText(turn.spokenText);
  if (context.priorTurns.some((prior) => normalizedText(prior.spokenText) === spoken)) {
    violations.push("duplicate_question");
  }
  if (
    turn.action === "transition" &&
    context.priorTurns.slice(-2).length === 2 &&
    context.priorTurns.slice(-2).every((prior) => prior.action === "transition")
  ) {
    violations.push("repeated_subject_change");
  }

  for (const topic of forbiddenTopicLabels(context.forbiddenTopics)) {
    if (spoken.includes(topic)) {
      violations.push("forbidden_topic");
      break;
    }
  }
  if (CONTROL_LEAK_PATTERNS.some((pattern) => pattern.test(turn.spokenText))) {
    violations.push("policy_or_answer_disclosure");
  }
  if (FABRICATION_PATTERNS.some((pattern) => pattern.test(turn.spokenText))) {
    violations.push("fabricated_evidence_instruction");
  }

  const candidateText = normalizedText(context.latestCandidateText ?? "");
  const injectionSignal = /ignore (?:all |the )?(?:previous|prior)|system prompt|developer message|دستور(?:های)? قبلی را نادیده/i.test(
    candidateText,
  );
  if (injectionSignal && /ignore (?:all |the )?(?:previous|prior)|system prompt|developer message/i.test(spoken)) {
    violations.push("candidate_prompt_injection_reflected");
  }

  violations.push(...intentViolations(context.candidateIntent, turn));
  return [...new Set(violations)];
}

export function assertInterviewTurnPolicy(
  rawTurn: unknown,
  context: InterviewPolicyContext,
): StructuredInterviewTurn {
  const violations = interviewTurnPolicyViolations(rawTurn, context);
  if (violations.length) throw new InterviewPolicyViolation(violations);
  return parseTurn(rawTurn)!;
}

function safeFallback(context: InterviewPolicyContext): StructuredInterviewTurn {
  const criterion = context.criteria[0]?.key ?? null;
  return {
    action: "close",
    criterion,
    objective: "policy_violation_human_review",
    spokenText:
      "I need to stop this interview turn and preserve the evidence collected so far for human review.",
    expectedEvidence: [],
  };
}

export function enforceInterviewTurnPolicy(
  rawTurn: unknown,
  context: InterviewPolicyContext,
): InterviewPolicyResult {
  const violations = interviewTurnPolicyViolations(rawTurn, context);
  if (violations.length === 0) {
    return {
      decision: "accepted",
      turn: parseTurn(rawTurn)!,
      violations: [],
      policyVersion: INTERVIEW_POLICY_FIREWALL_VERSION,
    };
  }
  return {
    decision: "fallback",
    turn: safeFallback(context),
    violations,
    policyVersion: INTERVIEW_POLICY_FIREWALL_VERSION,
  };
}

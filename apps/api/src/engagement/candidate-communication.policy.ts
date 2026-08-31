export interface CandidateReplyDraft {
  body: string;
  groundingReferences: string[];
  autoSendRequested: boolean;
  autoSendPolicyEnabled: boolean;
}

export interface CandidateReplyPolicyResult {
  allowed: boolean;
  approvalState: "approved_for_auto_send" | "requires_human_approval" | "blocked";
  reasons: string[];
}

export function evaluateCandidateReplyPolicy(draft: CandidateReplyDraft): CandidateReplyPolicyResult {
  const reasons: string[] = [];
  const body = draft.body.trim();

  if (!body) reasons.push("Reply body is empty");
  if (draft.groundingReferences.length === 0) {
    reasons.push("Candidate-facing factual replies require approved knowledge references");
  }

  if (reasons.length) {
    return {
      allowed: false,
      approvalState: "blocked",
      reasons,
    };
  }

  if (draft.autoSendRequested && draft.autoSendPolicyEnabled) {
    return {
      allowed: true,
      approvalState: "approved_for_auto_send",
      reasons: ["Grounding references are present and organization auto-send policy is enabled"],
    };
  }

  return {
    allowed: true,
    approvalState: "requires_human_approval",
    reasons: ["Human approval is required before outbound delivery"],
  };
}

export interface HardMinimumRule {
  key: string;
  required: boolean;
  expected: string | number | boolean;
}

export interface HardMinimumResult {
  eligible: boolean;
  failedRequiredRules: string[];
  reviewRequired: true;
}

export function evaluateHardMinimums(
  rules: HardMinimumRule[],
  answers: Record<string, string | number | boolean | null | undefined>,
): HardMinimumResult {
  const failedRequiredRules = rules
    .filter((rule) => rule.required)
    .filter((rule) => answers[rule.key] !== rule.expected)
    .map((rule) => rule.key);

  return {
    eligible: failedRequiredRules.length === 0,
    failedRequiredRules,
    reviewRequired: true,
  };
}

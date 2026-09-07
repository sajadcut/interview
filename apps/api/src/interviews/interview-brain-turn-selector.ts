import type { StructuredInterviewTurn } from "./interview-contracts";
import {
  enforceInterviewTurnPolicy,
  type InterviewPolicyContext,
  type InterviewPolicyResult,
} from "./interview-policy-firewall";

export interface InterviewBrainTurnSelection {
  mode: "llm" | "deterministic_fallback";
  policy: InterviewPolicyResult;
  fallbackReason?: string;
  rejectedLlmViolations: string[];
}

export function selectInterviewBrainTurn(input: {
  deterministicTurn: StructuredInterviewTurn;
  llmTurn?: StructuredInterviewTurn;
  llmFailureReason?: string;
  policyContext: InterviewPolicyContext;
}): InterviewBrainTurnSelection {
  if (input.llmTurn) {
    const llmPolicy = enforceInterviewTurnPolicy(input.llmTurn, input.policyContext);
    if (llmPolicy.decision === "accepted") {
      return {
        mode: "llm",
        policy: llmPolicy,
        rejectedLlmViolations: [],
      };
    }
    const deterministicPolicy = enforceInterviewTurnPolicy(input.deterministicTurn, input.policyContext);
    return {
      mode: "deterministic_fallback",
      policy: deterministicPolicy,
      fallbackReason: `policy_rejection:${llmPolicy.violations.join("+")}`.slice(0, 240),
      rejectedLlmViolations: llmPolicy.violations,
    };
  }

  return {
    mode: "deterministic_fallback",
    policy: enforceInterviewTurnPolicy(input.deterministicTurn, input.policyContext),
    fallbackReason: (input.llmFailureReason || "llm_not_attempted").slice(0, 240),
    rejectedLlmViolations: [],
  };
}

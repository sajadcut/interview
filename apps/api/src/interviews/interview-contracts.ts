export const CandidateIntents = [
  "ANSWER",
  "CLARIFICATION_REQUEST",
  "SKIP_REQUEST",
  "INTERRUPTION",
  "SILENCE_TIMEOUT",
  "RECONNECT",
  "CANDIDATE_QUESTION",
  "POLICY_REFUSAL",
] as const;

export type CandidateIntent = (typeof CandidateIntents)[number];

export const InterviewActions = ["ask", "probe", "clarify", "transition", "close", "escalate"] as const;
export type InterviewAction = (typeof InterviewActions)[number];

export interface StructuredInterviewTurn {
  action: InterviewAction;
  criterion: string | null;
  objective: string;
  spokenText: string;
  expectedEvidence: string[];
}

export interface InterviewStateSnapshot {
  currentCriterion: string | null;
  askedQuestionIds: string[];
  evidenceFound: string[];
  evidenceMissing: string[];
  criterionConfidence: Record<string, number>;
  remainingSeconds: number;
  resumeClaimUnderValidation: string | null;
  contradictionSignals: string[];
  candidateIntent: CandidateIntent | null;
  reconnectCount: number;
}

export interface InterviewerTurnRequest {
  planVersion: string;
  policyVersion: string;
  state: InterviewStateSnapshot;
  latestCandidateText: string;
}

export interface InterviewerEngine {
  generateTurn(request: InterviewerTurnRequest): Promise<StructuredInterviewTurn>;
}

export interface InterviewEvidenceRecord {
  evidenceId: string;
  criterionId: string;
  summary: string;
  transcriptSegmentIds: string[];
  confidence?: number;
}

export interface InterviewEvaluationRequest {
  rubricVersionId: string;
  evaluatorVersion: string;
  evidence: InterviewEvidenceRecord[];
}

export interface CriterionEvaluationDraft {
  criterionId: string;
  score: number;
  rationale: string;
  evidenceIds: string[];
  confidence?: number;
}

export interface InterviewEvaluationDraft {
  criterionEvaluations: CriterionEvaluationDraft[];
  recommendation: string;
}

export interface InterviewEvaluator {
  evaluate(request: InterviewEvaluationRequest): Promise<InterviewEvaluationDraft>;
}

export function validateStructuredInterviewTurn(turn: StructuredInterviewTurn): void {
  if (!InterviewActions.includes(turn.action)) throw new Error("Unsupported interview action");
  if (!turn.spokenText.trim()) throw new Error("spokenText is required");
  if (!turn.objective.trim()) throw new Error("objective is required");
  if ((turn.action === "ask" || turn.action === "probe") && turn.expectedEvidence.length === 0) {
    throw new Error("Evidence-seeking interview turns require expectedEvidence");
  }
}

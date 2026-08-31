export type Identifier = string;

export type HumanReviewState = "pending" | "approved" | "overridden" | "rejected";

export interface EvidenceReference {
  id: Identifier;
  sourceType: string;
  sourceReference: string;
  excerpt?: string;
  occurredAt?: string;
}

export interface CriterionEvaluation {
  criterionId: Identifier;
  score: number;
  confidence?: number;
  rationale?: string;
  evidenceIds: Identifier[];
  evaluatorType: "human" | "ai";
  evaluatorVersion?: string;
  reviewState: HumanReviewState;
}

export interface CandidateApplicationSummary {
  applicationId: Identifier;
  candidateId: Identifier;
  jobId: Identifier;
  stage: string;
  source?: string;
  preInterviewMatchScore?: number;
}

export interface SourcingResult {
  sourceType: "internal_talent_pool" | "ats" | "approved_job_board" | "approved_external";
  candidateId?: Identifier;
  displayName: string;
  retrievalScore: number;
  evidenceSummary: string[];
  dedupeState: "resolved_internal" | "resolved_external" | "unresolved" | "merge_review";
}

export interface GroundedCandidateMessage {
  body: string;
  groundingReferences: Identifier[];
  approvalState: "not_required" | "requires_human_approval" | "approved" | "rejected";
}

export type CandidateInterviewIntent =
  | "ANSWER"
  | "CLARIFICATION_REQUEST"
  | "SKIP_REQUEST"
  | "INTERRUPTION"
  | "SILENCE_TIMEOUT"
  | "RECONNECT"
  | "CANDIDATE_QUESTION"
  | "POLICY_REFUSAL";

export interface StructuredInterviewTurn {
  action: "ask" | "probe" | "clarify" | "transition" | "close" | "escalate";
  criterion: string | null;
  objective: string;
  spokenText: string;
  expectedEvidence: string[];
}

export type InterviewReleaseStage =
  | "DEV_ONLY"
  | "INTERNAL_TEST"
  | "SHADOW"
  | "SUPERVISED_PILOT"
  | "CONTROLLED_PRODUCTION"
  | "SCALED_PRODUCTION"
  | "SUSPENDED";

export interface AssessmentResultSummary {
  assessmentSessionId: Identifier;
  runnerType: string;
  runnerVersion: string;
  passedTests?: number;
  totalTests?: number;
  normalizedScore?: number;
  integritySignals: string[];
}

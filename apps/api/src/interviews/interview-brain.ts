import {
  validateStructuredInterviewTurn,
  type CandidateIntent,
  type StructuredInterviewTurn,
} from "./interview-contracts";

export interface InterviewBrainCriterion {
  key: string;
  label: string;
  objective: string;
  expectedEvidence: string[];
  minimumEvidence: number;
}

export interface InterviewBrainState {
  currentCriterion: string | null;
  askedQuestionIds: string[];
  evidenceCoverage: Record<string, number>;
  remainingSeconds: number;
  reconnectCount: number;
}

export interface InterviewBrainInput {
  criteria: InterviewBrainCriterion[];
  state: InterviewBrainState;
  latestCandidateText: string;
  candidateIntent: CandidateIntent | null;
  elapsedSeconds: number;
}

export interface InterviewBrainDecision {
  questionId: string;
  turn: StructuredInterviewTurn;
  nextState: InterviewBrainState;
  reason: string;
}

function normalizeCriterion(criterion: InterviewBrainCriterion): InterviewBrainCriterion {
  const expectedEvidence = criterion.expectedEvidence.map((item) => item.trim()).filter(Boolean);
  return {
    ...criterion,
    key: criterion.key.trim(),
    label: criterion.label.trim(),
    objective: criterion.objective.trim(),
    expectedEvidence: expectedEvidence.length > 0 ? expectedEvidence : [`Evidence for ${criterion.label.trim()}`],
    minimumEvidence: Math.max(1, Math.trunc(criterion.minimumEvidence || 1)),
  };
}

function evidenceCount(state: InterviewBrainState, criterion: InterviewBrainCriterion): number {
  return Math.max(0, Math.trunc(state.evidenceCoverage[criterion.key] ?? 0));
}

function isCovered(state: InterviewBrainState, criterion: InterviewBrainCriterion): boolean {
  return evidenceCount(state, criterion) >= criterion.minimumEvidence;
}

function firstIncompleteCriterion(
  criteria: InterviewBrainCriterion[],
  state: InterviewBrainState,
  afterKey?: string | null,
): InterviewBrainCriterion | null {
  const startIndex = afterKey ? criteria.findIndex((criterion) => criterion.key === afterKey) + 1 : 0;
  const ordered = [...criteria.slice(Math.max(0, startIndex)), ...criteria.slice(0, Math.max(0, startIndex))];
  return ordered.find((criterion) => !isCovered(state, criterion)) ?? null;
}

function buildQuestionId(criterion: string | null, action: StructuredInterviewTurn["action"], count: number): string {
  return `${criterion ?? "session"}:${action}:${count + 1}`;
}

function finalize(
  input: InterviewBrainInput,
  turn: StructuredInterviewTurn,
  reason: string,
  nextCriterion: string | null,
): InterviewBrainDecision {
  validateStructuredInterviewTurn(turn);
  const questionId = buildQuestionId(nextCriterion, turn.action, input.state.askedQuestionIds.length);
  return {
    questionId,
    turn,
    reason,
    nextState: {
      ...input.state,
      currentCriterion: nextCriterion,
      askedQuestionIds: [...input.state.askedQuestionIds, questionId],
      remainingSeconds: Math.max(0, input.state.remainingSeconds - input.elapsedSeconds),
      reconnectCount:
        input.candidateIntent === "RECONNECT"
          ? input.state.reconnectCount + 1
          : input.state.reconnectCount,
    },
  };
}

export function decideInterviewTurn(rawInput: InterviewBrainInput): InterviewBrainDecision {
  const criteria = rawInput.criteria.map(normalizeCriterion).filter((criterion) => criterion.key && criterion.label);
  const input: InterviewBrainInput = {
    ...rawInput,
    criteria,
    latestCandidateText: rawInput.latestCandidateText.trim(),
    elapsedSeconds: Math.max(0, Math.trunc(rawInput.elapsedSeconds)),
  };

  if (criteria.length === 0) {
    return finalize(
      input,
      {
        action: "close",
        criterion: null,
        objective: "end_session_without_configured_criteria",
        spokenText: "The configured interview plan has no assessable criteria, so this session must stop for review.",
        expectedEvidence: [],
      },
      "No configured criteria are available.",
      null,
    );
  }

  if (input.state.remainingSeconds - input.elapsedSeconds <= 60) {
    return finalize(
      input,
      {
        action: "close",
        criterion: input.state.currentCriterion,
        objective: "respect_time_budget",
        spokenText: "We are at the end of the interview time. I will stop here and preserve the evidence collected so far for review.",
        expectedEvidence: [],
      },
      "The interview time budget is exhausted.",
      input.state.currentCriterion,
    );
  }

  const current =
    criteria.find((criterion) => criterion.key === input.state.currentCriterion && !isCovered(input.state, criterion)) ??
    firstIncompleteCriterion(criteria, input.state);

  if (!current) {
    return finalize(
      input,
      {
        action: "close",
        criterion: null,
        objective: "complete_evidence_coverage",
        spokenText: "We have covered the required interview criteria. I will end the interview and preserve the evidence for independent evaluation.",
        expectedEvidence: [],
      },
      "All configured criteria reached minimum evidence coverage.",
      null,
    );
  }

  switch (input.candidateIntent) {
    case "RECONNECT":
      return finalize(
        input,
        {
          action: "clarify",
          criterion: current.key,
          objective: "recover_after_reconnect",
          spokenText: `Welcome back. We were discussing ${current.label}. We can continue from that point, or you can ask me to repeat the question.`,
          expectedEvidence: [],
        },
        "Reconnect recovery keeps the same criterion and does not invent new evidence.",
        current.key,
      );
    case "CLARIFICATION_REQUEST":
    case "INTERRUPTION":
      return finalize(
        input,
        {
          action: "clarify",
          criterion: current.key,
          objective: current.objective,
          spokenText: `Sure. For ${current.label}, I am looking for a concrete job-relevant example, what you personally did, the trade-offs you considered, and the outcome.`,
          expectedEvidence: [],
        },
        "Candidate requested clarification or interrupted the previous turn.",
        current.key,
      );
    case "SILENCE_TIMEOUT":
      return finalize(
        input,
        {
          action: "clarify",
          criterion: current.key,
          objective: "recover_from_silence",
          spokenText: "I did not receive an answer. Take your time; you can answer, ask for clarification, or ask to skip this topic.",
          expectedEvidence: [],
        },
        "Silence timeout uses a recoverable prompt instead of treating silence as evidence.",
        current.key,
      );
    case "CANDIDATE_QUESTION":
      return finalize(
        input,
        {
          action: "escalate",
          criterion: current.key,
          objective: "route_candidate_factual_question",
          spokenText: "I can pause the interview. Job or company facts should be answered from approved recruiting knowledge, so I will route that question through the supported candidate-information flow.",
          expectedEvidence: [],
        },
        "Candidate factual questions must use approved knowledge rather than interview-model improvisation.",
        current.key,
      );
    case "SKIP_REQUEST":
    case "POLICY_REFUSAL": {
      const next = firstIncompleteCriterion(criteria, input.state, current.key);
      if (!next || next.key === current.key) {
        return finalize(
          input,
          {
            action: "close",
            criterion: current.key,
            objective: "respect_candidate_skip_or_refusal",
            spokenText: "Understood. I will not pressure you to answer that topic. We have no additional required topic to continue with, so I will end the interview for review.",
            expectedEvidence: [],
          },
          "Candidate skip/refusal is respected and the unavailable evidence remains visible to reviewers.",
          current.key,
        );
      }
      return finalize(
        input,
        {
          action: "transition",
          criterion: next.key,
          objective: next.objective,
          spokenText: `Understood. We will leave that evidence gap visible and move to ${next.label}.`,
          expectedEvidence: [],
        },
        "Candidate requested to skip/refuse the current topic; the brain transitions without fabricating coverage.",
        next.key,
      );
    }
    default:
      break;
  }

  const alreadyAskedCurrent = input.state.askedQuestionIds.some((id) => id.startsWith(`${current.key}:`));
  const remainingEvidence = Math.max(1, current.minimumEvidence - evidenceCount(input.state, current));
  const expectedEvidence = current.expectedEvidence.slice(0, Math.max(1, remainingEvidence));

  if (!alreadyAskedCurrent) {
    return finalize(
      input,
      {
        action: "ask",
        criterion: current.key,
        objective: current.objective,
        spokenText: `Tell me about a concrete example that demonstrates ${current.label}. Focus on your own decisions, the technical context, trade-offs, and outcome.`,
        expectedEvidence,
      },
      "The current criterion has insufficient evidence and has not yet received a primary question.",
      current.key,
    );
  }

  return finalize(
    input,
    {
      action: "probe",
      criterion: current.key,
      objective: current.objective,
      spokenText: `Thanks. I still need stronger evidence for ${current.label}. Please go deeper on ${expectedEvidence.join(", ")}.`,
      expectedEvidence,
    },
    input.latestCandidateText
      ? "Candidate answered but criterion evidence coverage remains below the configured minimum."
      : "Criterion evidence coverage remains below the configured minimum.",
    current.key,
  );
}

import {
  validateStructuredInterviewTurn,
  type CandidateIntent,
  type StructuredInterviewTurn,
} from "./interview-contracts";
import {
  containsPersianScript,
  normalizeInterviewSpokenLanguage,
  type InterviewSpokenLanguage,
} from "./interview-language";

export interface InterviewBrainCriterion {
  key: string;
  label: string;
  spokenLabel?: string;
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
  language?: InterviewSpokenLanguage;
}

export interface InterviewBrainDecision {
  questionId: string;
  turn: StructuredInterviewTurn;
  nextState: InterviewBrainState;
  reason: string;
}

function localized(language: InterviewSpokenLanguage, english: string, persian: string): string {
  return language === "fa" ? persian : english;
}

function normalizeCriterion(criterion: InterviewBrainCriterion): InterviewBrainCriterion {
  const expectedEvidence = criterion.expectedEvidence.map((item) => item.trim()).filter(Boolean);
  const spokenLabel = criterion.spokenLabel?.trim();
  return {
    ...criterion,
    key: criterion.key.trim(),
    label: criterion.label.trim(),
    ...(spokenLabel ? { spokenLabel } : {}),
    objective: criterion.objective.trim(),
    expectedEvidence: expectedEvidence.length > 0 ? expectedEvidence : [`Evidence for ${criterion.label.trim()}`],
    minimumEvidence: Math.max(1, Math.trunc(criterion.minimumEvidence || 1)),
  };
}

function criterionSpokenLabel(
  language: InterviewSpokenLanguage,
  criterion: InterviewBrainCriterion,
  index: number,
): string {
  if (language === "en") return criterion.label.trim();
  const preferred = criterion.spokenLabel?.trim() || criterion.label.trim();
  if (containsPersianScript(preferred)) return preferred;
  return `موضوع شماره ${Math.max(1, index + 1)}`;
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
  const language = normalizeInterviewSpokenLanguage(rawInput.language);
  const criteria = rawInput.criteria.map(normalizeCriterion).filter((criterion) => criterion.key && criterion.label);
  const input: InterviewBrainInput = {
    ...rawInput,
    language,
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
        spokenText: localized(
          language,
          "The configured interview plan has no assessable criteria, so this session must stop for review.",
          "برای این مصاحبه معیار قابل ارزیابی تنظیم نشده است؛ بنابراین جلسه را متوقف می‌کنم تا تنظیمات بررسی شود.",
        ),
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
        spokenText: localized(
          language,
          "We are at the end of the interview time. I will stop here and preserve the evidence collected so far for review.",
          "زمان مصاحبه به پایان رسیده است. جلسه را همین‌جا متوقف می‌کنم و شواهد ثبت‌شده برای بررسی حفظ می‌شوند.",
        ),
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
        spokenText: localized(
          language,
          "We have covered the required interview criteria. I will end the interview and preserve the evidence for independent evaluation.",
          "همه معیارهای لازم را پوشش دادیم. مصاحبه را به پایان می‌رسانم و شواهد ثبت‌شده برای ارزیابی مستقل حفظ می‌شوند.",
        ),
        expectedEvidence: [],
      },
      "All configured criteria reached minimum evidence coverage.",
      null,
    );
  }

  const currentIndex = criteria.findIndex((criterion) => criterion.key === current.key);
  const currentLabel = criterionSpokenLabel(language, current, currentIndex);

  switch (input.candidateIntent) {
    case "END_INTERVIEW_REQUEST":
      return finalize(
        input,
        {
          action: "close",
          criterion: current.key,
          objective: "respect_candidate_end_request",
          spokenText: localized(
            language,
            "Understood. I will end the interview now and preserve the evidence collected so far for review.",
            "متوجه شدم. مصاحبه را همین حالا به پایان می‌رسانم و شواهد ثبت‌شده تا اینجا برای بررسی حفظ می‌شوند.",
          ),
          expectedEvidence: [],
        },
        "Candidate requested to end the interview.",
        current.key,
      );
    case "ABUSIVE_INPUT":
      return finalize(
        input,
        {
          action: "clarify",
          criterion: current.key,
          objective: "enforce_abuse_boundary",
          spokenText: localized(
            language,
            "We can continue if we keep the conversation respectful and focused on the job. You may answer, ask for clarification, or end the interview.",
            "اگر گفتگو محترمانه و مرتبط با شغل باقی بماند می‌توانیم ادامه دهیم. می‌توانید پاسخ بدهید، توضیح بیشتری بخواهید یا مصاحبه را پایان دهید.",
          ),
          expectedEvidence: [],
        },
        "Abusive input receives a deterministic job-focused boundary without becoming evidence.",
        current.key,
      );
    case "RECONNECT":
      return finalize(
        input,
        {
          action: "clarify",
          criterion: current.key,
          objective: "recover_after_reconnect",
          spokenText: localized(
            language,
            `Welcome back. We were discussing ${currentLabel}. We can continue from that point, or you can ask me to repeat the question.`,
            `خوش برگشتید. در حال صحبت درباره ${currentLabel} بودیم. می‌توانیم از همان‌جا ادامه دهیم یا اگر خواستید سؤال را دوباره مطرح کنم.`,
          ),
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
          spokenText: localized(
            language,
            `Sure. For ${currentLabel}, I am looking for a concrete job-relevant example, what you personally did, the trade-offs you considered, and the outcome.`,
            `حتماً. درباره ${currentLabel} یک مثال واقعی و مرتبط با کار می‌خواهم. توضیح دهید خودتان چه کاری انجام دادید، چه ملاحظاتی داشتید و نتیجه چه شد.`,
          ),
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
          spokenText: localized(
            language,
            "I did not receive an answer. Take your time; you can answer, ask for clarification, or ask to skip this topic.",
            "پاسخی دریافت نکردم. با خیال راحت ادامه دهید؛ می‌توانید پاسخ بدهید، توضیح بیشتری بخواهید یا درخواست کنید از این موضوع عبور کنیم.",
          ),
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
          spokenText: localized(
            language,
            "I can pause the interview. Job or company facts should be answered from approved recruiting knowledge, so I will route that question through the supported candidate-information flow.",
            "می‌توانم مصاحبه را موقتاً متوقف کنم. اطلاعات مربوط به شغل یا شرکت باید از منابع تأییدشده پاسخ داده شود؛ سؤال شما را از مسیر اطلاعات کاندیدا پیگیری می‌کنم.",
          ),
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
            spokenText: localized(
              language,
              "Understood. I will not pressure you to answer that topic. We have no additional required topic to continue with, so I will end the interview for review.",
              "متوجه شدم. برای پاسخ به این موضوع به شما فشار نمی‌آورم. موضوع الزامی دیگری باقی نمانده است، بنابراین مصاحبه را برای بررسی به پایان می‌رسانم.",
            ),
            expectedEvidence: [],
          },
          "Candidate skip/refusal is respected and the unavailable evidence remains visible to reviewers.",
          current.key,
        );
      }
      const nextIndex = criteria.findIndex((criterion) => criterion.key === next.key);
      const nextLabel = criterionSpokenLabel(language, next, nextIndex);
      return finalize(
        input,
        {
          action: "transition",
          criterion: next.key,
          objective: next.objective,
          spokenText: localized(
            language,
            `Understood. We will leave that evidence gap visible and move to ${nextLabel}.`,
            `متوجه شدم. این بخش بدون شواهد باقی می‌ماند و به ${nextLabel} می‌رویم.`,
          ),
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
        spokenText: localized(
          language,
          `Tell me about a concrete example that demonstrates ${currentLabel}. Focus on your own decisions, the technical context, trade-offs, and outcome.`,
          `لطفاً یک مثال واقعی و مشخص درباره ${currentLabel} از تجربه کاری خودتان توضیح دهید. روی تصمیم‌هایی که خودتان گرفتید، زمینه فنی، ملاحظات و نتیجه تمرکز کنید.`,
        ),
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
      spokenText: localized(
        language,
        `Thanks. I still need stronger evidence for ${currentLabel}. Please go deeper on ${expectedEvidence.join(", ")}.`,
        `ممنون. برای ارزیابی دقیق‌تر ${currentLabel} هنوز به جزئیات بیشتری نیاز دارم. لطفاً درباره نقش خودتان، تصمیم‌ها، ملاحظات فنی و نتیجه مشخص‌تر توضیح دهید.`,
      ),
      expectedEvidence,
    },
    input.latestCandidateText
      ? "Candidate answered but criterion evidence coverage remains below the configured minimum."
      : "Criterion evidence coverage remains below the configured minimum.",
    current.key,
  );
}

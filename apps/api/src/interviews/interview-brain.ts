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

export type InterviewQuestionSource =
  | "lifecycle"
  | "rubric"
  | "job_requirement"
  | "resume_claim"
  | "adaptive_follow_up";

export type InterviewTurnKind =
  | "introduction"
  | "planned_criterion"
  | "resume_validation"
  | "adaptive_follow_up"
  | "transition"
  | "candidate_question"
  | "closing";

export interface InterviewBrainCriterion {
  key: string;
  label: string;
  spokenLabel?: string;
  objective: string;
  expectedEvidence: string[];
  minimumEvidence: number;
  required?: boolean;
  weight?: number;
  priority?: number;
  baseSource?: "rubric" | "job_requirement";
}

export interface InterviewBrainResumeClaim {
  id: string;
  claimType: string;
  text: string;
  importance: number;
  status: "unverified" | "supported" | "contradicted" | "insufficient_evidence";
  matchedCriterionKey: string | null;
}

export interface InterviewBrainState {
  currentCriterion: string | null;
  askedQuestionIds: string[];
  evidenceCoverage: Record<string, number>;
  remainingSeconds: number;
  reconnectCount: number;
  questionCountByCriterion?: Record<string, number>;
  askedResumeClaimIds?: string[];
  resumeClaims?: InterviewBrainResumeClaim[];
  closingStage?: "interview" | "candidate_question";
}

export interface InterviewBrainInput {
  criteria: InterviewBrainCriterion[];
  state: InterviewBrainState;
  latestCandidateText: string;
  candidateIntent: CandidateIntent | null;
  elapsedSeconds: number;
  language?: InterviewSpokenLanguage;
  approvedCandidateQuestionAnswer?: string | null;
  candidateName?: string;
}

export interface InterviewBrainDecision {
  questionId: string;
  turn: StructuredInterviewTurn;
  turnKind: InterviewTurnKind;
  questionSource: InterviewQuestionSource;
  resumeClaimId: string | null;
  nextState: InterviewBrainState;
  reason: string;
}

const PERSIAN_CRITERION_LABELS: Readonly<Record<string, string>> = {
  backend_depth: "مهندسی بک‌اند",
  system_design: "طراحی سیستم",
  dotnet_fundamentals: "مبانی سی‌شارپ و دات‌نت",
  aspnet_core: "اِی‌اِس‌پی دات‌نِت کور و وب اِی‌پی‌آی",
  architecture: "معماری نرم‌افزار",
  database: "پایگاه داده و مدل‌سازی داده",
  sql: "اِس‌کیو‌اِل و بهینه‌سازی کوئری",
  ef_core: "اِنتیتی فریم‌ورک کور",
  concurrency: "پردازش ناهمگام و هم‌روندی",
  caching: "کش و رِدیس",
  distributed_systems: "سیستم‌های توزیع‌شده",
  messaging: "پیام‌رسانی",
  performance: "کارایی و مقیاس‌پذیری",
  testing: "تست",
  security: "امنیت",
  debugging: "اشکال‌زدایی و عیب‌یابی محیط تولید",
  observability: "مشاهده‌پذیری",
  devops: "سی‌آی/سی‌دی و دواپس",
};

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
    expectedEvidence: expectedEvidence.length > 0
      ? expectedEvidence
      : [`Concrete job-relevant evidence for ${criterion.label.trim()}`],
    minimumEvidence: Math.max(1, Math.trunc(criterion.minimumEvidence || 1)),
    required: criterion.required !== false,
    weight: Number.isFinite(criterion.weight) ? Math.max(0, Number(criterion.weight)) : 1,
    priority: Number.isFinite(criterion.priority) ? Number(criterion.priority) : 0,
    baseSource: criterion.baseSource === "job_requirement" ? "job_requirement" : "rubric",
  };
}

function criterionSpokenLabel(
  language: InterviewSpokenLanguage,
  criterion: InterviewBrainCriterion,
): string {
  if (language === "en") return criterion.label.trim();
  const preferred = criterion.spokenLabel?.trim() || criterion.label.trim();
  if (containsPersianScript(preferred)) return preferred;
  return PERSIAN_CRITERION_LABELS[criterion.key.trim().toLowerCase()] ?? "این بخش تخصصی";
}

function evidenceCount(state: InterviewBrainState, criterion: InterviewBrainCriterion): number {
  return Math.max(0, Math.trunc(state.evidenceCoverage[criterion.key] ?? 0));
}

function isCovered(state: InterviewBrainState, criterion: InterviewBrainCriterion): boolean {
  return evidenceCount(state, criterion) >= criterion.minimumEvidence;
}

function claimImportanceForCriterion(
  state: InterviewBrainState,
  criterion: InterviewBrainCriterion,
): number {
  return Math.max(
    0,
    ...(state.resumeClaims ?? [])
      .filter((claim) => claim.matchedCriterionKey === criterion.key && claim.status !== "supported")
      .map((claim) => claim.importance),
  );
}

function criterionScore(
  state: InterviewBrainState,
  criterion: InterviewBrainCriterion,
  endingSoon: boolean,
): number {
  const requiredBoost = criterion.required === false ? 0 : 10_000;
  const priority = Number(criterion.priority ?? 0) * 100;
  const weight = Number(criterion.weight ?? 1) * 25;
  const resume = claimImportanceForCriterion(state, criterion) * 20;
  const current = state.currentCriterion === criterion.key && !endingSoon ? 12 : 0;
  const coverageGap = Math.max(0, criterion.minimumEvidence - evidenceCount(state, criterion)) * 8;
  return requiredBoost + priority + weight + resume + current + coverageGap;
}

function selectIncompleteCriterion(
  criteria: InterviewBrainCriterion[],
  state: InterviewBrainState,
  remainingSeconds: number,
  afterKey?: string | null,
): InterviewBrainCriterion | null {
  const endingSoon = remainingSeconds <= 300;
  const candidates = criteria.filter((criterion) => {
    if (isCovered(state, criterion)) return false;
    if (endingSoon && criterion.required === false) return false;
    return true;
  });
  if (candidates.length === 0) return null;

  const questionCount = state.questionCountByCriterion ?? {};
  const current = candidates.find((criterion) => criterion.key === state.currentCriterion);
  if (
    current &&
    !endingSoon &&
    (questionCount[current.key] ?? 0) < 2 &&
    (!afterKey || afterKey !== current.key)
  ) {
    return current;
  }

  const alternatives = afterKey
    ? candidates.filter((criterion) => criterion.key !== afterKey)
    : candidates;
  const selectionPool = alternatives.length > 0 ? alternatives : candidates;

  return [...selectionPool].sort((left, right) => {
    const scoreDelta = criterionScore(state, right, endingSoon) - criterionScore(state, left, endingSoon);
    if (scoreDelta !== 0) return scoreDelta;
    return criteria.indexOf(left) - criteria.indexOf(right);
  })[0] ?? null;
}

function buildQuestionId(
  criterion: string | null,
  action: StructuredInterviewTurn["action"],
  count: number,
): string {
  return `${criterion ?? "session"}:${action}:${count + 1}`;
}

function finalize(
  input: InterviewBrainInput,
  turn: StructuredInterviewTurn,
  reason: string,
  nextCriterion: string | null,
  metadata: {
    turnKind: InterviewTurnKind;
    questionSource: InterviewQuestionSource;
    resumeClaimId?: string | null;
    closingStage?: InterviewBrainState["closingStage"];
  },
): InterviewBrainDecision {
  validateStructuredInterviewTurn(turn);
  const questionId = buildQuestionId(nextCriterion, turn.action, input.state.askedQuestionIds.length);
  return {
    questionId,
    turn,
    turnKind: metadata.turnKind,
    questionSource: metadata.questionSource,
    resumeClaimId: metadata.resumeClaimId ?? null,
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
      closingStage: metadata.closingStage ?? input.state.closingStage ?? "interview",
      ...(metadata.resumeClaimId
        ? {
            askedResumeClaimIds: [
              ...new Set([...(input.state.askedResumeClaimIds ?? []), metadata.resumeClaimId]),
            ],
          }
        : {}),
    },
  };
}

function finalGoodbye(
  input: InterviewBrainInput,
  language: InterviewSpokenLanguage,
  reason: string,
): InterviewBrainDecision {
  const approvedAnswer = input.approvedCandidateQuestionAnswer?.trim();
  const candidateName = input.candidateName?.trim();
  const goodbye = localized(
    language,
    candidateName
      ? `Thank you, ${candidateName}. The questions for this stage are complete. The recorded answers and evidence will be evaluated independently, and the hiring team retains final decision authority. Thank you for your time, and best of luck.`
      : "Thank you. The questions for this stage are complete. The recorded answers and evidence will be evaluated independently, and the hiring team retains final decision authority. Thank you for your time, and best of luck.",
    candidateName
      ? `ممنون ${candidateName}. سؤال‌های این مرحله به پایان رسید. پاسخ‌ها و شواهد ثبت‌شده به‌صورت مستقل ارزیابی می‌شوند و تصمیم نهایی توسط تیم استخدام بررسی خواهد شد. از وقتی که برای این مصاحبه گذاشتید متشکرم. موفق باشید.`
      : "ممنون. سؤال‌های این مرحله به پایان رسید. پاسخ‌ها و شواهد ثبت‌شده به‌صورت مستقل ارزیابی می‌شوند و تصمیم نهایی توسط تیم استخدام بررسی خواهد شد. از وقتی که برای این مصاحبه گذاشتید متشکرم. موفق باشید.",
  );
  return finalize(
    input,
    {
      action: "close",
      criterion: null,
      objective: "final_goodbye",
      spokenText: approvedAnswer ? `${approvedAnswer} ${goodbye}` : goodbye,
      expectedEvidence: [],
    },
    reason,
    null,
    { turnKind: "closing", questionSource: "lifecycle", closingStage: "candidate_question" },
  );
}

function candidateQuestionOpportunity(
  input: InterviewBrainInput,
  language: InterviewSpokenLanguage,
  reason: string,
): InterviewBrainDecision {
  return finalize(
    input,
    {
      action: "escalate",
      criterion: null,
      objective: "candidate_question_opportunity",
      spokenText: localized(
        language,
        "We have finished the main interview questions. Before we close, if you have a short question about the interview process or this role, you can ask it now.",
        "سؤال‌های اصلی مصاحبه تمام شد. قبل از پایان، اگر درباره فرایند مصاحبه یا این موقعیت شغلی سؤال کوتاهی دارید، مطرح کنید.",
      ),
      expectedEvidence: [],
    },
    reason,
    input.state.currentCriterion,
    {
      turnKind: "candidate_question",
      questionSource: "lifecycle",
      closingStage: "candidate_question",
    },
  );
}

function availableResumeClaim(
  state: InterviewBrainState,
  criterion: InterviewBrainCriterion,
): InterviewBrainResumeClaim | null {
  const asked = new Set(state.askedResumeClaimIds ?? []);
  return [...(state.resumeClaims ?? [])]
    .filter(
      (claim) =>
        claim.matchedCriterionKey === criterion.key &&
        claim.status !== "supported" &&
        !asked.has(claim.id),
    )
    .sort((left, right) => right.importance - left.importance)[0] ?? null;
}

export function decideInterviewTurn(rawInput: InterviewBrainInput): InterviewBrainDecision {
  const language = normalizeInterviewSpokenLanguage(rawInput.language);
  const criteria = rawInput.criteria.map(normalizeCriterion).filter((criterion) => criterion.key && criterion.label);
  const inferredQuestionCounts: Record<string, number> = {};
  for (const questionId of rawInput.state.askedQuestionIds) {
    const [criterion, action] = questionId.split(":");
    if (criterion && criterion !== "session" && (action === "ask" || action === "probe")) {
      inferredQuestionCounts[criterion] = (inferredQuestionCounts[criterion] ?? 0) + 1;
    }
  }
  const input: InterviewBrainInput = {
    ...rawInput,
    language,
    criteria,
    latestCandidateText: rawInput.latestCandidateText.trim(),
    elapsedSeconds: Math.max(0, Math.trunc(rawInput.elapsedSeconds)),
    state: {
      ...rawInput.state,
      closingStage: rawInput.state.closingStage ?? "interview",
      questionCountByCriterion: rawInput.state.questionCountByCriterion ?? inferredQuestionCounts,
      askedResumeClaimIds: rawInput.state.askedResumeClaimIds ?? [],
      resumeClaims: rawInput.state.resumeClaims ?? [],
    },
  };
  const remainingSeconds = Math.max(0, input.state.remainingSeconds - input.elapsedSeconds);

  if (input.state.closingStage === "candidate_question") {
    return finalGoodbye(
      input,
      language,
      "The candidate-question opportunity is complete; deterministic closing is required.",
    );
  }

  if (input.candidateIntent === "END_INTERVIEW_REQUEST") {
    return finalGoodbye(input, language, "Candidate requested to end the interview.");
  }

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
      { turnKind: "closing", questionSource: "lifecycle" },
    );
  }

  if (remainingSeconds <= 0) {
    return finalGoodbye(input, language, "The interview time budget is exhausted.");
  }

  if (remainingSeconds <= 60) {
    return candidateQuestionOpportunity(
      input,
      language,
      "The final minute prohibits new assessment questions and enters wrap-up.",
    );
  }

  const current =
    criteria.find(
      (criterion) =>
        criterion.key === input.state.currentCriterion &&
        !isCovered(input.state, criterion) &&
        !(remainingSeconds <= 300 && criterion.required === false),
    ) ?? selectIncompleteCriterion(criteria, input.state, remainingSeconds);

  if (!current) {
    return candidateQuestionOpportunity(
      input,
      language,
      "All eligible criteria reached minimum evidence coverage.",
    );
  }

  const currentLabel = criterionSpokenLabel(language, current);

  switch (input.candidateIntent) {
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
        { turnKind: "transition", questionSource: "lifecycle" },
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
        { turnKind: "transition", questionSource: "lifecycle" },
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
            `Sure. For ${currentLabel}, please use one concrete job-relevant example and focus on the decision you personally made and its outcome.`,
            `حتماً. درباره ${currentLabel} یک نمونه واقعی و مرتبط با کار بگویید و روی تصمیمی که شخصاً گرفتید و نتیجهٔ آن تمرکز کنید.`,
          ),
          expectedEvidence: [],
        },
        "Candidate requested clarification or interrupted the previous turn.",
        current.key,
        { turnKind: "adaptive_follow_up", questionSource: "adaptive_follow_up" },
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
        { turnKind: "transition", questionSource: "lifecycle" },
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
            "I can pause the assessment question. Job or company facts must come from approved recruiting information, so I will only answer from that source.",
            "می‌توانم سؤال ارزیابی را موقتاً نگه دارم. اطلاعات مربوط به شغل یا شرکت فقط باید از اطلاعات تأییدشده جذب پاسخ داده شود.",
          ),
          expectedEvidence: [],
        },
        "Candidate factual questions must use approved knowledge rather than interviewer-model improvisation.",
        current.key,
        { turnKind: "transition", questionSource: "lifecycle" },
      );
    case "SKIP_REQUEST":
    case "POLICY_REFUSAL": {
      const next = selectIncompleteCriterion(criteria, input.state, remainingSeconds, current.key);
      if (!next || next.key === current.key) {
        return candidateQuestionOpportunity(
          input,
          language,
          "Candidate skip/refusal leaves the remaining gap visible and no other eligible topic remains.",
        );
      }
      const nextLabel = criterionSpokenLabel(language, next);
      return finalize(
        input,
        {
          action: "ask",
          criterion: next.key,
          objective: next.objective,
          spokenText: localized(
            language,
            `Understood. We will leave that gap visible and move to ${nextLabel}. Please give one concrete example from your own work and focus on the decision you made and its outcome.`,
            `متوجه شدم. این بخش بدون شواهد کافی باقی می‌ماند و به ${nextLabel} می‌رویم. لطفاً یک نمونهٔ واقعی از کار خودتان بگویید و روی تصمیمی که گرفتید و نتیجهٔ آن تمرکز کنید.`,
          ),
          expectedEvidence: next.expectedEvidence.slice(0, 1),
        },
        "Candidate requested to skip/refuse the current topic; the brain moves to the next criterion without fabricating coverage.",
        next.key,
        { turnKind: "planned_criterion", questionSource: next.baseSource ?? "rubric" },
      );
    }
    default:
      break;
  }

  const questionCount = input.state.questionCountByCriterion?.[current.key] ?? 0;
  if (questionCount >= 2) {
    const next = selectIncompleteCriterion(criteria, input.state, remainingSeconds, current.key);
    if (next && next.key !== current.key) {
      const nextLabel = criterionSpokenLabel(language, next);
      return finalize(
        input,
        {
          action: "ask",
          criterion: next.key,
          objective: next.objective,
          spokenText: localized(
            language,
            `Let's move to ${nextLabel}. Please give one concrete example from your own work and focus on your decision and the observed outcome.`,
            `برای اینکه زمان مصاحبه متعادل بماند، به ${nextLabel} می‌رویم. لطفاً یک نمونهٔ واقعی از کار خودتان بگویید و روی تصمیم و نتیجهٔ قابل مشاهده تمرکز کنید.`,
          ),
          expectedEvidence: next.expectedEvidence.slice(0, 1),
        },
        "Topic dwell limit reached; preserve the evidence gap and ask the next priority criterion.",
        next.key,
        { turnKind: "planned_criterion", questionSource: next.baseSource ?? "rubric" },
      );
    }
  }

  const remainingEvidence = Math.max(1, current.minimumEvidence - evidenceCount(input.state, current));
  const expectedEvidence = current.expectedEvidence.slice(0, Math.max(1, remainingEvidence));
  const resumeClaim = availableResumeClaim(input.state, current);

  if (resumeClaim) {
    const boundedClaim = resumeClaim.text.replace(/\s+/g, " ").trim().slice(0, 280);
    return finalize(
      input,
      {
        action: "ask",
        criterion: current.key,
        objective: current.objective,
        spokenText: localized(
          language,
          `Your resume mentions “${boundedClaim}”. Please walk me through one concrete example that makes your personal role, main decision, and observed outcome clear.`,
          `در رزومه به «${boundedClaim}» اشاره کرده‌اید. لطفاً یک نمونهٔ مشخص توضیح دهید که نقش شخصی شما، تصمیم اصلی و نتیجهٔ قابل مشاهده را روشن کند.`,
        ),
        expectedEvidence,
      },
      "A high-value resume claim maps to the current rubric criterion and is still unverified.",
      current.key,
      {
        turnKind: "resume_validation",
        questionSource: "resume_claim",
        resumeClaimId: resumeClaim.id,
      },
    );
  }

  if (questionCount === 0) {
    return finalize(
      input,
      {
        action: "ask",
        criterion: current.key,
        objective: current.objective,
        spokenText: localized(
          language,
          `Tell me about a concrete example that demonstrates ${currentLabel}. Focus on a decision you personally made, a relevant trade-off, and the observed outcome.`,
          `لطفاً یک نمونهٔ واقعی از تجربهٔ کاری خود درباره ${currentLabel} تعریف کنید. روی تصمیمی که شخصاً گرفتید، یک ملاحظه یا بده‌بستان مهم و نتیجهٔ قابل مشاهده تمرکز کنید.`,
        ),
        expectedEvidence,
      },
      remainingSeconds <= 300
        ? "Final-five-minute strategy selected the highest-priority required evidence gap."
        : "The selected criterion has insufficient evidence and needs a primary question.",
      current.key,
      {
        turnKind: "planned_criterion",
        questionSource: current.baseSource ?? "rubric",
      },
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
        `Based on your last answer about ${currentLabel}, go one level deeper on the most important missing point: the decision, trade-off, failure mode, ownership, debugging detail, scale, or observable outcome.`,
        `بر اساس پاسخ قبلی‌تان درباره ${currentLabel}، فقط روی مهم‌ترین بخشِ هنوز نامشخص عمیق‌تر شویم؛ مثلاً تصمیم، بده‌بستان، حالت شکست، نقش شخصی، جزئیات عیب‌یابی، مقیاس یا نتیجهٔ قابل مشاهده.`,
      ),
      expectedEvidence,
    },
    input.latestCandidateText
      ? "The previous answer is relevant but the selected criterion still has an evidence gap."
      : "The selected criterion still has an evidence gap.",
    current.key,
    { turnKind: "adaptive_follow_up", questionSource: "adaptive_follow_up" },
  );
}

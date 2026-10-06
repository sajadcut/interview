export const DEFAULT_SOFT_SKILL_LABELS = [
  "وضوح و ساختار ارتباط",
  "حل مسئله و مدیریت ابهام",
  "همکاری و کار تیمی",
  "مالکیت و مسئولیت‌پذیری",
] as const;

const stableKeys: Array<[RegExp, string]> = [
  [/وضوح|ارتباط|communication/i, "communication"],
  [/حل مسئله|ابهام|problem/i, "problem_solving"],
  [/همکاری|تیمی|collaboration|teamwork/i, "collaboration"],
  [/مالکیت|مسئولیت|ownership/i, "ownership"],
  [/تصمیم|decision/i, "decision_making"],
  [/trade.?off|بده.?بستان|موازنه/i, "tradeoff_reasoning"],
  [/طراحی سیستم|system design/i, "system_design"],
  [/معماری|architecture/i, "architecture"],
  [/asp.?net|web api|وب.*api|وب.*ای.?پی.?آی/i, "aspnet_core"],
  [/c#|\.net|dotnet|دات.?نت|سی.?شارپ/i, "dotnet_fundamentals"],
  [/پایگاه داده|database|data modeling/i, "database"],
  [/\bsql\b|query|کوئری/i, "sql"],
  [/entity framework|ef core|orm|اِنتیتی|اورم/i, "ef_core"],
  [/async|concurr|هم.?روند|ناهمگام/i, "concurrency"],
  [/redis|cache|کش/i, "caching"],
  [/distributed|توزیع/i, "distributed_systems"],
  [/messag|kafka|rabbit|پیام/i, "messaging"],
  [/performance|scalab|کارایی|مقیاس/i, "performance"],
  [/testing|تست/i, "testing"],
  [/security|امنیت|auth/i, "security"],
  [/debug|troubleshoot|عیب.?یابی|اشکال.?زدایی/i, "debugging"],
  [/observability|monitor|trace|metric|مشاهده.?پذیری/i, "observability"],
  [/ci.?cd|devops|دواپس|pipeline/i, "devops"],
  [/بک.?اند|backend/i, "backend_depth"],
];

export interface InterviewCoverageCriterion {
  criterionKey?: string;
  label: string;
  required: boolean;
}

export interface InterviewCoverageRequirement {
  name: string;
  requirementType: "must_have" | "nice_to_have";
}

export type InterviewCoverageStatus = "required" | "optional" | "missing";

export interface InterviewCoverageArea {
  key: string;
  label: string;
  group: "technical" | "soft_skill";
  status: InterviewCoverageStatus;
  matchedCriteria: string[];
  relevantFromJob: boolean;
}

const COVERAGE_DEFINITIONS: ReadonlyArray<{
  key: string;
  label: string;
  group: "technical" | "soft_skill";
  pattern: RegExp;
}> = [
  { key: "dotnet_fundamentals", label: "مبانی C# / .NET", group: "technical", pattern: /c#|\.net|dotnet|دات.?نت|سی.?شارپ/i },
  { key: "aspnet_core", label: "ASP.NET Core / Web API", group: "technical", pattern: /asp.?net|web api|api|اِی.?پی.?آی/i },
  { key: "architecture", label: "معماری نرم‌افزار", group: "technical", pattern: /architect|معماری/i },
  { key: "system_design", label: "طراحی سیستم", group: "technical", pattern: /system design|طراحی سیستم/i },
  { key: "database", label: "پایگاه داده / مدل‌سازی داده", group: "technical", pattern: /database|data model|پایگاه داده|مدل.?سازی داده/i },
  { key: "sql", label: "SQL / بهینه‌سازی Query", group: "technical", pattern: /\bsql\b|query|کوئری/i },
  { key: "ef_core", label: "ORM / EF Core", group: "technical", pattern: /entity framework|ef core|orm|اورم/i },
  { key: "concurrency", label: "Async / Concurrency", group: "technical", pattern: /async|concurr|ناهمگام|هم.?روند/i },
  { key: "caching", label: "Caching / Redis", group: "technical", pattern: /cache|redis|کش/i },
  { key: "distributed_systems", label: "سیستم‌های توزیع‌شده", group: "technical", pattern: /distributed|توزیع/i },
  { key: "messaging", label: "Messaging", group: "technical", pattern: /messag|kafka|rabbit|پیام/i },
  { key: "performance", label: "Performance / Scalability", group: "technical", pattern: /performance|scalab|latency|throughput|کارایی|مقیاس/i },
  { key: "testing", label: "Testing", group: "technical", pattern: /test|تست/i },
  { key: "security", label: "Security", group: "technical", pattern: /security|oauth|oidc|auth|امنیت/i },
  { key: "debugging", label: "Debugging / Production Troubleshooting", group: "technical", pattern: /debug|troubleshoot|incident|عیب.?یابی|اشکال.?زدایی|محیط تولید/i },
  { key: "observability", label: "Observability", group: "technical", pattern: /observability|monitor|trace|metric|مشاهده.?پذیری/i },
  { key: "devops", label: "CI/CD / DevOps", group: "technical", pattern: /ci.?cd|devops|pipeline|docker|kubernetes|دواپس/i },
  { key: "communication", label: "وضوح و ساختار ارتباط", group: "soft_skill", pattern: /communication|ارتباط|وضوح/i },
  { key: "problem_solving", label: "حل مسئله / مدیریت ابهام", group: "soft_skill", pattern: /problem|ambigu|حل مسئله|ابهام/i },
  { key: "collaboration", label: "همکاری تیمی / ارتباط با ذی‌نفع", group: "soft_skill", pattern: /collaboration|teamwork|stakeholder|همکاری|تیمی|ذی.?نفع/i },
  { key: "ownership", label: "Ownership", group: "soft_skill", pattern: /ownership|مالکیت|مسئولیت/i },
  { key: "decision_making", label: "تصمیم‌گیری", group: "soft_skill", pattern: /decision|تصمیم/i },
  { key: "tradeoff_reasoning", label: "استدلال درباره trade-off", group: "soft_skill", pattern: /trade.?off|بده.?بستان|موازنه/i },
];

export function criterionKeyForLabel(value: string, index: number): string {
  for (const [pattern, key] of stableKeys) {
    if (pattern.test(value)) return key;
  }
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || `criterion_${index + 1}`;
}

export function appendDefaultSoftSkills(labels: string[]): string[] {
  const normalized = new Set(labels.map((item) => item.trim().toLowerCase()));
  return [
    ...labels,
    ...DEFAULT_SOFT_SKILL_LABELS.filter((label) => !normalized.has(label.toLowerCase())),
  ];
}

export function isSoftSkillCriterion(input: {
  criterionKey?: string;
  label?: string;
  evidencePolicy?: Record<string, unknown>;
}): boolean {
  if (input.evidencePolicy?.category === "soft_skill") return true;
  return stableKeys.slice(0, 6).some(([pattern]) =>
    pattern.test(`${input.criterionKey ?? ""} ${input.label ?? ""}`),
  );
}

export function buildInterviewCoverage(input: {
  title?: string;
  seniority?: string;
  summary?: string;
  requirements: InterviewCoverageRequirement[];
  criteria: InterviewCoverageCriterion[];
}): InterviewCoverageArea[] {
  const jobText = [
    input.title,
    input.seniority,
    input.summary,
    ...input.requirements.map((item) => item.name),
  ].filter(Boolean).join(" ");
  const seniorDotnet =
    /c#|\.net|dotnet|asp.?net|دات.?نت|سی.?شارپ/i.test(jobText) &&
    /senior|lead|staff|principal|ارشد|لید|رهبر/i.test(jobText);

  return COVERAGE_DEFINITIONS
    .filter((definition) =>
      seniorDotnet ||
      definition.group === "soft_skill" ||
      definition.pattern.test(jobText) ||
      input.criteria.some((criterion) =>
        definition.pattern.test(`${criterion.criterionKey ?? ""} ${criterion.label}`),
      ),
    )
    .map((definition) => {
      const matched = input.criteria.filter((criterion) =>
        definition.pattern.test(`${criterion.criterionKey ?? ""} ${criterion.label}`),
      );
      const relevantFromJob = definition.pattern.test(jobText);
      const status: InterviewCoverageStatus = matched.some((criterion) => criterion.required)
        ? "required"
        : matched.length
          ? "optional"
          : "missing";
      return {
        key: definition.key,
        label: definition.label,
        group: definition.group,
        status,
        matchedCriteria: matched.map((criterion) => criterion.label),
        relevantFromJob,
      };
    });
}

export function coverageSummary(areas: InterviewCoverageArea[]): {
  required: number;
  optional: number;
  missing: number;
} {
  return areas.reduce(
    (summary, area) => ({ ...summary, [area.status]: summary[area.status] + 1 }),
    { required: 0, optional: 0, missing: 0 },
  );
}

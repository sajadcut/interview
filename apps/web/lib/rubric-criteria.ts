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
  [/طراحی سیستم|system design/i, "system_design"],
  [/بک.?اند|backend/i, "backend_depth"],
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
  return stableKeys.slice(0, 4).some(([pattern]) =>
    pattern.test(`${input.criterionKey ?? ""} ${input.label ?? ""}`),
  );
}

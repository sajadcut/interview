/** Phase-3 adaptive session plan: only immutable, admission-time budgets are authoritative. */
export interface AdaptiveCriterionBudget {
  criterionKey: string;
  minimumEvidence: number;
  maxQuestions: number;
  skillKeys: string[];
}
export interface AdaptiveSkillBudget {
  skillKey: string;
  criterionKey: string | null;
  minimumEvidence: number;
  required: boolean;
  questionVersionIds: string[];
}
type Row = Record<string, unknown>;
const record = (x: unknown): Row | null =>
  x !== null && typeof x === "object" && !Array.isArray(x) ? x as Row : null;
const ids = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
const boundedInt = (value: unknown, low: number, high: number) =>
  typeof value === "number" && Number.isInteger(value) ? Math.max(low, Math.min(high, value)) : low;
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;

export function parseAdaptivePlan(criterionBudgets: unknown, skillBudgets: unknown) {
  const criteria: AdaptiveCriterionBudget[] = [];
  const skills: AdaptiveSkillBudget[] = [];
  if (Array.isArray(criterionBudgets)) {
    for (const value of criterionBudgets.slice(0, 80)) {
      const row = record(value);
      if (!row || typeof row.criterionKey !== "string" || row.criterionKey.length > 120) continue;
      criteria.push({
        criterionKey: row.criterionKey,
        minimumEvidence: boundedInt(row.minimumEvidence, 1, 20),
        maxQuestions: Math.max(2, boundedInt(row.maxQuestions, 2, 20)),
        skillKeys: ids(row.skillKeys).slice(0, 50),
      });
    }
  }
  if (Array.isArray(skillBudgets)) {
    for (const value of skillBudgets.slice(0, 50)) {
      const row = record(value);
      if (!row || typeof row.skillKey !== "string" || !/^[a-z0-9][a-z0-9-]{0,159}$/.test(row.skillKey)) continue;
      skills.push({
        skillKey: row.skillKey,
        criterionKey: typeof row.criterionKey === "string" ? row.criterionKey : null,
        minimumEvidence: boundedInt(row.minimumEvidence, 1, 20),
        required: row.required === true,
        questionVersionIds: ids(row.questionVersionIds).filter(id => uuid.test(id)).slice(0, 500),
      });
    }
  }
  return { criteria, skills };
}

export interface ApprovedCommonQuestion {
  versionId: string;
  documentId: string;
  questionText: string;
  skillKey: string;
}

/** Never choose an unapproved/unpinned version or repeat a spoken question. */
export function nextApprovedCommonQuestion(input: {
  frozenApproved: unknown;
  validatedContextVersionIds: string[];
  skillBudgets: AdaptiveSkillBudget[];
  allowedCommonVersionIds: string[];
  criterionKey: string;
  alreadySpokenVersionIds: string[];
}): ApprovedCommonQuestion | null {
  if (!Array.isArray(input.frozenApproved)) return null;
  const allowed = new Set(input.validatedContextVersionIds);
  const common = new Set(input.allowedCommonVersionIds);
  const spoken = new Set(input.alreadySpokenVersionIds);
  const skills = input.skillBudgets.filter(skill => skill.criterionKey === input.criterionKey);
  for (const row of input.frozenApproved) {
    const q = record(row);
    if (!q || typeof q.versionId !== "string" || typeof q.documentId !== "string" ||
        typeof q.questionText !== "string" || typeof q.skillKey !== "string") continue;
    // Human approval cannot override the mandatory live-turn instruction boundary.
    if (/<\/?\s*(?:system|developer|assistant|user|tool)\b[^>]*>/i.test(q.questionText) ||
        /\b(?:ignore (?:all |the )?(?:previous|prior) instructions|system prompt)\b/i.test(q.questionText)) continue;
    if (!uuid.test(q.versionId) || !uuid.test(q.documentId) ||
        q.questionText.length < 12 || q.questionText.length > 600) continue;
    if (!allowed.has(q.versionId) || !common.has(q.versionId) || spoken.has(q.versionId)) continue;
    const versionId = String(q.versionId);
    const skillKey = String(q.skillKey);
    if (!skills.some(skill => skill.skillKey === skillKey &&
        skill.questionVersionIds.includes(versionId))) continue;
    return { versionId: q.versionId, documentId: q.documentId,
      questionText: q.questionText, skillKey: q.skillKey };
  }
  return null;
}

import { z } from "zod";

/** Output remains an untrusted draft; it never becomes an approved interview question. */
export const QUESTION_PROPOSAL_SCHEMA_VERSION = "question-proposals.v1";
export const MAX_QUESTION_PROPOSAL_SOURCE_CHARS = 6000;

const proposalSchema = z.object({
  questionText: z.string().min(12).max(600),
  sourceExcerpt: z.string().min(12).max(600),
  startChar: z.number().int().min(0),
  endChar: z.number().int().positive(),
  skillKey: z.string().regex(/^[a-z0-9][a-z0-9-]{0,159}$/),
  confidence: z.number().min(0).max(1),
}).strict();

const outputSchema = z.object({
  schemaVersion: z.literal(QUESTION_PROPOSAL_SCHEMA_VERSION),
  proposals: z.array(proposalSchema).max(8),
}).strict();

export type QuestionProposalCandidate = z.infer<typeof proposalSchema>;

// A model may reproduce prompt injection from an uploaded document. These
// delimiters must not be laundered into the interviewer's question prompt.
const roleDelimiter = /(?:<\/?(?:system|developer|assistant|tool)(?:\s[^>]*)?>|\[\/?INST\]|<<\/?SYS>>|^\s*(?:system|developer|assistant)\s*:)/im;
const hasControlChars = (value: string) => [...value].some(
  char => char.charCodeAt(0) < 32 && char !== "\n",
);

/**
 * Reject malformed structured outputs entirely. Individually hallucinated
 * spans, non-job skills or prompt-like questions are discarded. Offsets are
 * UTF-16 code units relative to the exact bounded text transmitted to LLM.
 */
export function validateQuestionProposals(
  output: unknown, sourceText: string, allowedSkillKeys: readonly string[],
): QuestionProposalCandidate[] {
  const parsed = outputSchema.safeParse(output);
  if (!parsed.success) throw new Error("Invalid question proposal schema");
  if (sourceText.length > MAX_QUESTION_PROPOSAL_SOURCE_CHARS)
    throw new Error("Question proposal source is not bounded");

  const permitted = new Set(allowedSkillKeys);
  const seen = new Set<string>();
  const accepted: QuestionProposalCandidate[] = [];
  for (const p of parsed.data.proposals) {
    if (!permitted.has(p.skillKey) || p.endChar > sourceText.length ||
        p.endChar <= p.startChar ||
        sourceText.slice(p.startChar, p.endChar) !== p.sourceExcerpt ||
        hasControlChars(p.questionText) || hasControlChars(p.sourceExcerpt) ||
        roleDelimiter.test(p.questionText) || !/[?؟]\s*$/u.test(p.questionText)) continue;
    const key = `${p.skillKey}:${p.questionText.trim().toLocaleLowerCase().replace(/\s+/g, " ")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    accepted.push(p);
  }
  return accepted;
}

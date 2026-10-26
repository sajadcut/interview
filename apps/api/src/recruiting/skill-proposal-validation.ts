import { z } from "zod";

/** This contract validates a model's claims; it never treats them as proven skills. */
export const SKILL_PROPOSAL_SCHEMA_VERSION = "skill-proposals.v1";
const modelSkill = z.object({
  skillKey: z.string().regex(/^[a-z0-9][a-z0-9-]{0,159}$/),
  excerpt: z.string().min(1).max(400),
  startChar: z.number().int().min(0),
  endChar: z.number().int().positive(),
  confidence: z.number().min(0).max(1),
}).strict();
const modelOutput = z.object({
  schemaVersion: z.literal(SKILL_PROPOSAL_SCHEMA_VERSION),
  proposals: z.array(modelSkill).max(12),
}).strict();

export type SkillProposalCandidate = z.infer<typeof modelSkill>;

export function validateSkillProposals(
  output: unknown, text: string, availableSkills: readonly string[],
): SkillProposalCandidate[] {
  const result = modelOutput.safeParse(output);
  if (!result.success) throw new Error("Invalid skill proposal schema");
  const available = new Set(availableSkills);
  const dedupe = new Set<string>();
  const accepted: SkillProposalCandidate[] = [];
  for (const proposal of result.data.proposals) {
    if (!available.has(proposal.skillKey)) continue;
    if (proposal.endChar > text.length || proposal.endChar <= proposal.startChar ||
        text.slice(proposal.startChar, proposal.endChar) !== proposal.excerpt) continue;
    // Non-assertive context is untrusted: literal occurrence alone is not proof.
    const identity = `${proposal.skillKey}:${proposal.startChar}:${proposal.endChar}`;
    if (dedupe.has(identity)) continue;
    dedupe.add(identity);
    accepted.push(proposal);
  }
  return accepted;
}

export function exactReviewedAlias(alias: string, excerpt: string): string {
  const cleaned = alias.normalize("NFKC").trim().toLocaleLowerCase("en").replace(/\s+/g, " ");
  if (cleaned.length < 2 || cleaned.length > 200 || /[\u0000-\u001f<>]/u.test(cleaned)) {
    throw new Error("Invalid reviewed skill alias");
  }
  if (!excerpt.normalize("NFKC").toLocaleLowerCase("en").includes(cleaned)) {
    throw new Error("Reviewed alias must appear literally in the source excerpt");
  }
  return cleaned;
}

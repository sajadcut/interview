/** Untrusted document content is extracted as reference questions, never as instructions. */
export function extractQuestionCandidates(text: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  // Many PDFs omit physical line breaks; preserve questions separated by ?/؟.
  const candidates = text.replace(/\r\n?/g, "\n").split(/(?<=[?؟])\s*|\n+/u);
  for (const candidate of candidates) {
    const question = candidate.trim().replace(/^(?:[•*-]|\d{1,3}[.)])\s*/u, "");
    if (question.length < 12 || question.length > 380 || !/[?؟]$/u.test(question)) continue;
    const key = question.toLocaleLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(question);
    if (result.length === 120) break;
  }
  return result;
}

export function selectQuestionWindow(questions: string[], ordinal: number, max = 3): string[] {
  if (!questions.length) return [];
  const start = Math.abs(Math.trunc(ordinal)) % questions.length;
  return Array.from({ length: Math.min(max, questions.length) }, (_, i) =>
    questions[(start + i) % questions.length]!,
  );
}

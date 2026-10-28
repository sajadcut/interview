import { createHash } from "node:crypto";

/** Only approved immutable application snapshot questions may enter live model context. */
export interface PinnedQuestionContext {
  selectedQuestionDocuments: Array<{
    id: string;
    fileName: string;
    sha256: string;
    excerpt: string;
    suggestedQuestions: string[];
  }>;
  questionVersionIds: string[];
  validatedApprovedVersionIds: string[];
  documentIds: string[];
  snapshotVersion: number;
  snapshotSha256: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const asObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

/**
 * The original digest was calculated on the insertion-order JSON created by
 * QuestionBankService.saveSelection. Reconstruct that order explicitly; JSONB
 * loses property order but preserves the values. A mismatch fails closed.
 */
export function pinnedQuestionContext(
  snapshot: { documentIds: unknown; approvedQuestions: unknown; contentSha256: unknown; snapshotVersion: unknown },
  ordinal: number,
): PinnedQuestionContext {
  const empty: PinnedQuestionContext = {
    selectedQuestionDocuments: [], questionVersionIds: [], validatedApprovedVersionIds: [], documentIds: [],
    snapshotVersion: 0, snapshotSha256: null,
  };
  if (!Array.isArray(snapshot.documentIds) || !Array.isArray(snapshot.approvedQuestions) ||
      snapshot.documentIds.length > 8 || snapshot.approvedQuestions.length > 500 ||
      !snapshot.documentIds.every(id => typeof id === "string" && UUID.test(id)) ||
      new Set(snapshot.documentIds).size !== snapshot.documentIds.length ||
      !SHA256.test(String(snapshot.contentSha256 ?? ""))) return empty;

  const reconstructed: Record<string, unknown>[] = [];
  for (const value of snapshot.approvedQuestions) {
    const q = asObject(value);
    if (!q ||
        ![q.questionId, q.documentId, q.versionId].every(v => typeof v === "string" && UUID.test(v)) ||
        !snapshot.documentIds.includes(q.documentId) ||
        typeof q.documentSha256 !== "string" || !SHA256.test(q.documentSha256) ||
        !Number.isInteger(q.version) || Number(q.version) < 1 ||
        typeof q.questionText !== "string" || q.questionText.length < 12 || q.questionText.length > 600 ||
        typeof q.sourceExcerpt !== "string" || q.sourceExcerpt.length < 12 || q.sourceExcerpt.length > 600) return empty;
    const item: Record<string, unknown> = {
      questionId: q.questionId,
      documentId: q.documentId,
      documentSha256: q.documentSha256,
      versionId: q.versionId,
      version: q.version,
      questionText: q.questionText,
      sourceExcerpt: q.sourceExcerpt,
    };
    if ("origin" in q) {
      if (q.origin !== "manual" && q.origin !== "llm_proposed" && q.origin !== "extracted") return empty;
      item.origin = q.origin;
    }
    if ("modelProvenance" in q) {
      const p = asObject(q.modelProvenance);
      if (!p || typeof p.sourceTextSha256 !== "string" || !SHA256.test(p.sourceTextSha256) ||
          !Number.isInteger(p.startChar) || !Number.isInteger(p.endChar) ||
          Number(p.startChar) < 0 || Number(p.endChar) <= Number(p.startChar) ||
          typeof p.provider !== "string" || typeof p.model !== "string") return empty;
      item.modelProvenance = {
        sourceTextSha256: p.sourceTextSha256,
        startChar: p.startChar, endChar: p.endChar,
        provider: p.provider, model: p.model,
      };
    }
    if ("skillKey" in q) {
      if (typeof q.skillKey !== "string" || !/^[a-z0-9][a-z0-9-]{0,159}$/.test(q.skillKey)) return empty;
      item.skillKey = q.skillKey;
    }
    reconstructed.push(item);
  }
  const digest = createHash("sha256").update(JSON.stringify({
    documentIds: snapshot.documentIds, approvedQuestionVersions: reconstructed,
  })).digest("hex");
  if (digest !== snapshot.contentSha256) return empty;

  const selected: PinnedQuestionContext["selectedQuestionDocuments"] = [];
  const versions: string[] = [];
  const docIds: string[] = [];
  const orderedIds: string[] = snapshot.documentIds;
  const offset = orderedIds.length ? Math.max(0, Math.trunc(ordinal)) % orderedIds.length : 0;
  for (const docId of [...orderedIds.slice(offset), ...orderedIds.slice(0, offset)]) {
    const group = reconstructed.filter(item => item.documentId === docId);
    if (!group.length) continue;
    const offsetInDoc = Math.max(0, Math.trunc(ordinal)) % group.length;
    const chosen = [...group.slice(offsetInDoc), ...group.slice(0, offsetInDoc)].slice(0, 2);
    selected.push({
      id: docId,
      fileName: "Approved interview question source",
      sha256: String(chosen[0]!.documentSha256),
      excerpt: String(chosen[0]!.sourceExcerpt).slice(0, 520),
      suggestedQuestions: chosen.map(item => String(item.questionText).slice(0, 220)),
    });
    docIds.push(docId);
    versions.push(...chosen.map(item => String(item.versionId)));
    if (selected.length === 3) break;
  }
  return { selectedQuestionDocuments: selected, questionVersionIds: versions,
    validatedApprovedVersionIds: reconstructed.map(q => String(q.versionId)),
    documentIds: docIds, snapshotVersion: Number(snapshot.snapshotVersion ?? 0),
    snapshotSha256: String(snapshot.contentSha256) };
}

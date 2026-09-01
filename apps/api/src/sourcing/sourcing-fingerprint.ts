import { createHash } from "node:crypto";
import type { CandidateSourceResult } from "./candidate-source.adapter";

function normalize(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function normalizedPhone(value: string | undefined): string {
  return value?.replace(/[^0-9+]/g, "") ?? "";
}

export function candidateDiscoveryFingerprint(result: CandidateSourceResult): string {
  const stableIdentity = [
    result.sourceType,
    normalize(result.sourceExternalKey),
    normalize(result.candidateId),
    normalize(result.normalizedIdentity?.email),
    normalizedPhone(result.normalizedIdentity?.phone),
    normalize(result.displayName),
    normalize(result.currentCompany),
  ].join("|");
  return createHash("sha256").update(stableIdentity).digest("hex");
}

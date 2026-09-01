import assert from "node:assert/strict";
import test from "node:test";
import { ApprovedSourceTypes, type CandidateSourceResult } from "./candidate-source.adapter";
import { candidateDiscoveryFingerprint } from "./sourcing-fingerprint";

function result(overrides: Partial<CandidateSourceResult> = {}): CandidateSourceResult {
  return {
    sourceType: ApprovedSourceTypes.Ats,
    sourceExternalKey: "candidate-42",
    displayName: "Ada Lovelace",
    currentCompany: "Analytical Engines",
    skills: ["TypeScript"],
    retrievalScore: 0.9,
    evidenceSummary: ["profile"],
    normalizedIdentity: { email: "Ada@Example.com", phone: "+1 (555) 0100" },
    provenance: {
      providerKey: "ats-test",
      sourceType: ApprovedSourceTypes.Ats,
      observedAt: "2026-09-01T00:00:00.000Z",
      retrievedAt: "2026-09-01T00:00:01.000Z",
      externalKey: "candidate-42",
      evidenceReferences: ["profile:candidate-42"],
    },
    ...overrides,
  };
}

test("discovery fingerprint is stable across harmless identity formatting differences", () => {
  const first = candidateDiscoveryFingerprint(result());
  const second = candidateDiscoveryFingerprint(
    result({
      displayName: "  ADA LOVELACE ",
      currentCompany: " analytical engines ",
      normalizedIdentity: { email: " ada@example.com ", phone: "+15550100" },
    }),
  );
  assert.equal(first, second);
});

test("discovery fingerprint changes when the stable external identity changes", () => {
  assert.notEqual(
    candidateDiscoveryFingerprint(result()),
    candidateDiscoveryFingerprint(result({ sourceExternalKey: "candidate-43" })),
  );
});

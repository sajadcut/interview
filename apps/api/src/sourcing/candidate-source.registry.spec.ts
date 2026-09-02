import assert from "node:assert/strict";
import test from "node:test";
import type { DatabaseService } from "../database/database.service";
import { ApprovedSourceTypes } from "./candidate-source.adapter";
import { CandidateSourceRegistry } from "./candidate-source.registry";
import { InternalTalentPoolAdapter } from "./internal-talent-pool.adapter";

function registry(): CandidateSourceRegistry {
  const database = {} as DatabaseService;
  return new CandidateSourceRegistry(new InternalTalentPoolAdapter(database));
}

test("candidate source registry exposes internal talent as the only configured source", () => {
  const capabilities = registry().capabilities();
  const internal = capabilities.find(
    (item) => item.sourceType === ApprovedSourceTypes.InternalTalentPool,
  );
  assert.deepEqual(internal, {
    sourceType: ApprovedSourceTypes.InternalTalentPool,
    configured: true,
    providerKey: "internal-postgres",
    requiresApproval: false,
  });

  for (const sourceType of [ApprovedSourceTypes.Ats, ApprovedSourceTypes.JobBoard]) {
    const capability = capabilities.find((item) => item.sourceType === sourceType);
    assert.equal(capability?.configured, false);
    assert.equal(capability?.requiresApproval, true);
    assert.equal("providerKey" in (capability ?? {}), false);
  }
});

test("unconfigured external candidate sources fail closed", () => {
  const sources = registry();
  assert.equal(sources.get(ApprovedSourceTypes.InternalTalentPool).providerKey, "internal-postgres");
  assert.throws(
    () => sources.get(ApprovedSourceTypes.Ats),
    /adapter ats is not configured/i,
  );
  assert.throws(
    () => sources.get(ApprovedSourceTypes.JobBoard),
    /adapter job_board is not configured/i,
  );
});

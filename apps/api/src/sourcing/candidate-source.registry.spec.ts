import assert from "node:assert/strict";
import test from "node:test";
import type { DatabaseService } from "../database/database.service";
import type { TenantContextService } from "../tenant/tenant-context.service";
import { ApprovedSourceTypes } from "./candidate-source.adapter";
import { CandidateSourceRegistry } from "./candidate-source.registry";
import type { ConfiguredAtsSourceAdapter } from "./configured-ats-source.adapter";
import type { GreenhouseAtsProvider } from "./greenhouse-ats.provider";
import { InternalTalentPoolAdapter } from "./internal-talent-pool.adapter";
import type { LeverAtsProvider } from "./lever-ats.provider";

function registry(): CandidateSourceRegistry {
  const database = {} as DatabaseService;
  const tenantContext = {
    getOptional: () => undefined,
  } as unknown as TenantContextService;
  const configuredAts = {
    sourceType: ApprovedSourceTypes.Ats,
    providerKey: "configured-ats",
    requiresApproval: true,
  } as unknown as ConfiguredAtsSourceAdapter;
  const greenhouse = {
    sourceType: ApprovedSourceTypes.Ats,
    providerKey: "greenhouse",
    requiresApproval: true,
    isConfiguredFor: async () => false,
  } as unknown as GreenhouseAtsProvider;
  const lever = {
    sourceType: ApprovedSourceTypes.Ats,
    providerKey: "lever",
    requiresApproval: true,
    isConfiguredFor: async () => false,
  } as unknown as LeverAtsProvider;

  return new CandidateSourceRegistry(
    tenantContext,
    new InternalTalentPoolAdapter(database),
    configuredAts,
    greenhouse,
    lever,
  );
}

test("candidate source registry exposes internal talent and tenant-aware ATS capabilities", async () => {
  const capabilities = await registry().capabilities();
  const internal = capabilities.find(
    (item) => item.sourceType === ApprovedSourceTypes.InternalTalentPool,
  );
  assert.deepEqual(internal, {
    sourceType: ApprovedSourceTypes.InternalTalentPool,
    configured: true,
    providerKey: "internal-postgres",
    requiresApproval: false,
  });

  const ats = capabilities.filter((item) => item.sourceType === ApprovedSourceTypes.Ats);
  assert.deepEqual(
    ats.map((item) => ({
      configured: item.configured,
      providerKey: "providerKey" in item ? item.providerKey : undefined,
      requiresApproval: item.requiresApproval,
    })),
    [
      { configured: false, providerKey: "greenhouse", requiresApproval: true },
      { configured: false, providerKey: "lever", requiresApproval: true },
    ],
  );

  for (const sourceType of [
    ApprovedSourceTypes.ApprovedJobBoard,
    ApprovedSourceTypes.ApprovedExternal,
  ]) {
    const capability = capabilities.find((item) => item.sourceType === sourceType);
    assert.equal(capability?.configured, false);
    assert.equal(capability?.requiresApproval, true);
    assert.equal("providerKey" in (capability ?? {}), false);
  }
});

test("candidate source registry resolves only approved configured adapters", () => {
  const sources = registry();
  assert.equal(sources.get(ApprovedSourceTypes.InternalTalentPool).providerKey, "internal-postgres");
  assert.equal(sources.get(ApprovedSourceTypes.Ats).providerKey, "configured-ats");
  assert.equal(sources.get(ApprovedSourceTypes.Ats, "greenhouse").providerKey, "greenhouse");
  assert.equal(sources.get(ApprovedSourceTypes.Ats, "lever").providerKey, "lever");

  assert.throws(
    () => sources.get(ApprovedSourceTypes.Ats, "unsupported"),
    /providerKey must be greenhouse or lever/i,
  );

  for (const sourceType of [
    ApprovedSourceTypes.ApprovedJobBoard,
    ApprovedSourceTypes.ApprovedExternal,
  ]) {
    assert.throws(
      () => sources.get(sourceType),
      new RegExp(`adapter ${sourceType} is not configured`, "i"),
    );
  }
});

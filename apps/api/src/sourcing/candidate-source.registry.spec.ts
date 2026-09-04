import assert from "node:assert/strict";
import test from "node:test";
import type { DatabaseService } from "../database/database.service";
import type { TenantContextService } from "../tenant/tenant-context.service";
import { ApprovedSourceTypes } from "./candidate-source.adapter";
import { CandidateSourceRegistry } from "./candidate-source.registry";
import type { ConfiguredAtsSourceAdapter } from "./configured-ats-source.adapter";
import type { CoresignalCandidateSourceProvider, PeopleDataLabsCandidateSourceProvider } from "./external-source.providers";
import type { GreenhouseAtsProvider } from "./greenhouse-ats.provider";
import { InternalTalentPoolAdapter } from "./internal-talent-pool.adapter";
import type { LeverAtsProvider } from "./lever-ats.provider";

function registry(): CandidateSourceRegistry {
  const database = {} as DatabaseService;
  const tenantContext = { getOptional: () => undefined } as unknown as TenantContextService;
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
  const peopleDataLabs = {
    sourceType: ApprovedSourceTypes.ApprovedExternal,
    providerKey: "people_data_labs",
    requiresApproval: true,
    isConfiguredFor: async () => false,
  } as unknown as PeopleDataLabsCandidateSourceProvider;
  const coresignal = {
    sourceType: ApprovedSourceTypes.ApprovedExternal,
    providerKey: "coresignal",
    requiresApproval: true,
    isConfiguredFor: async () => false,
  } as unknown as CoresignalCandidateSourceProvider;

  return new CandidateSourceRegistry(
    tenantContext,
    new InternalTalentPoolAdapter(database),
    configuredAts,
    greenhouse,
    lever,
    peopleDataLabs,
    coresignal,
  );
}

test("candidate source registry exposes tenant-aware ATS and approved external capabilities", async () => {
  const capabilities = await registry().capabilities();
  const internal = capabilities.find((item) => item.sourceType === ApprovedSourceTypes.InternalTalentPool);
  assert.deepEqual(internal, {
    sourceType: ApprovedSourceTypes.InternalTalentPool,
    configured: true,
    providerKey: "internal-postgres",
    requiresApproval: false,
  });

  const ats = capabilities.filter((item) => item.sourceType === ApprovedSourceTypes.Ats);
  assert.deepEqual(ats.map((item) => item.providerKey), ["greenhouse", "lever"]);
  assert.ok(ats.every((item) => item.configured === false && item.requiresApproval === true));

  const external = capabilities.filter((item) => item.sourceType === ApprovedSourceTypes.ApprovedExternal);
  assert.deepEqual(external.map((item) => item.providerKey), ["people_data_labs", "coresignal"]);
  assert.ok(external.every((item) => item.configured === false && item.requiresApproval === true));

  const jobBoard = capabilities.find((item) => item.sourceType === ApprovedSourceTypes.ApprovedJobBoard);
  assert.equal(jobBoard?.configured, false);
  assert.equal(jobBoard?.requiresApproval, true);
});

test("candidate source registry resolves only explicitly approved provider keys", () => {
  const sources = registry();
  assert.equal(sources.get(ApprovedSourceTypes.InternalTalentPool).providerKey, "internal-postgres");
  assert.equal(sources.get(ApprovedSourceTypes.Ats).providerKey, "configured-ats");
  assert.equal(sources.get(ApprovedSourceTypes.Ats, "greenhouse").providerKey, "greenhouse");
  assert.equal(sources.get(ApprovedSourceTypes.Ats, "lever").providerKey, "lever");
  assert.equal(sources.get(ApprovedSourceTypes.ApprovedExternal, "people_data_labs").providerKey, "people_data_labs");
  assert.equal(sources.get(ApprovedSourceTypes.ApprovedExternal, "coresignal").providerKey, "coresignal");

  assert.throws(() => sources.get(ApprovedSourceTypes.Ats, "unsupported"), /providerKey must be greenhouse or lever/i);
  assert.throws(() => sources.get(ApprovedSourceTypes.ApprovedExternal), /providerKey is required/i);
  assert.throws(
    () => sources.get(ApprovedSourceTypes.ApprovedExternal, "unsupported"),
    /providerKey must be people_data_labs or coresignal/i,
  );
  assert.throws(
    () => sources.get(ApprovedSourceTypes.ApprovedJobBoard),
    /adapter approved_job_board is not configured/i,
  );
});

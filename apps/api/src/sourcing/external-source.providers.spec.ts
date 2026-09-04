import assert from "node:assert/strict";
import test from "node:test";
import type { ExternalSourceConnectionService } from "./external-source-connection.service";
import { CoresignalCandidateSourceProvider, PeopleDataLabsCandidateSourceProvider } from "./external-source.providers";

function connectionService(providerKey: "people_data_labs" | "coresignal") {
  return {
    require: async () => ({
      id: "integration-1",
      organizationId: "00000000-0000-0000-0000-000000000001",
      providerKey,
      status: "configured",
      credentialReference: "env://TEST_SOURCE",
      config: { approvedForRecruitingUse: true, privacyUseApproved: true },
    }),
    apiKey: () => "test-key",
    isConfiguredFor: async () => true,
  } as unknown as ExternalSourceConnectionService;
}

const request = {
  organizationId: "00000000-0000-0000-0000-000000000001",
  jobId: "00000000-0000-0000-0000-000000000002",
  query: "Python Engineer",
  limit: 5,
};

test("People Data Labs provider uses official search endpoint and maps provenance", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  let requestedHeaders: unknown;
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedHeaders = init?.headers;
    return new Response(JSON.stringify({ data: [{
      id: "pdl-123",
      full_name: "Ada Lovelace",
      job_title: "Python Engineer",
      job_company_name: "Analytical Systems",
      skills: ["Python", "Distributed Systems"],
      location_name: "London, UK",
      linkedin_url: "https://www.linkedin.com/in/example",
      updated_at: "2026-08-01T00:00:00Z",
    }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const results = await new PeopleDataLabsCandidateSourceProvider(connectionService("people_data_labs")).search(request);
    assert.equal(requestedUrl, "https://api.peopledatalabs.com/v5/person/search");
    assert.equal(new Headers(requestedHeaders as ConstructorParameters<typeof Headers>[0]).get("x-api-key"), "test-key");
    assert.equal(results.length, 1);
    assert.equal(results[0]?.displayName, "Ada Lovelace");
    assert.equal(results[0]?.provenance.providerKey, "people_data_labs");
    assert.deepEqual(results[0]?.skills, ["Python", "Distributed Systems"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Coresignal provider uses official preview endpoint and never invents skills", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  let requestedHeaders: unknown;
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedHeaders = init?.headers;
    return new Response(JSON.stringify([{
      id: 456,
      full_name: "Grace Hopper",
      headline: "Compiler Engineer",
      active_experience_title: "Python Engineer",
      company_name: "Example Company",
      location_full: "New York, US",
      professional_network_url: "https://www.linkedin.com/in/example-2",
      checked_at: "2026-08-02T00:00:00Z",
      _score: 8.2,
    }]), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const results = await new CoresignalCandidateSourceProvider(connectionService("coresignal")).search(request);
    assert.match(requestedUrl, /^https:\/\/api\.coresignal\.com\/cdapi\/v2\/employee_multi_source\/search\/es_dsl\/preview/);
    assert.equal(new Headers(requestedHeaders as ConstructorParameters<typeof Headers>[0]).get("apikey"), "test-key");
    assert.equal(results.length, 1);
    assert.equal(results[0]?.provenance.providerKey, "coresignal");
    assert.deepEqual(results[0]?.skills, []);
    assert.ok((results[0]?.retrievalScore ?? 0) > 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

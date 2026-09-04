import { Injectable } from "@nestjs/common";
import {
  ApprovedSourceTypes,
  type CandidateSourceResult,
  type CandidateSourceSearchRequest,
} from "./candidate-source.adapter";
import {
  ExternalSourceConnectionService,
  type ExternalSourceProviderKey,
} from "./external-source-connection.service";
import { assertExternalSourceResponse, externalSourceFetch } from "./external-source-http";

function records(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  }
  if (value && typeof value === "object") {
    const data = (value as Record<string, unknown>).data;
    if (Array.isArray(data)) {
      return data.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
    }
  }
  return [];
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function textList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => text(item)).filter((item): item is string => Boolean(item));
}

function retrievalScore(query: string, values: Array<string | undefined>): number {
  const tokens = [...new Set(query.toLocaleLowerCase().split(/[^\p{L}\p{N}+#.-]+/u).filter((token) => token.length >= 2))];
  if (!tokens.length) return 0.5;
  const haystack = values.filter(Boolean).join(" ").toLocaleLowerCase();
  const matches = tokens.filter((token) => haystack.includes(token)).length;
  return Math.max(0.05, Math.min(1, Number((matches / tokens.length).toFixed(4))));
}

function observedAt(record: Record<string, unknown>): string {
  const raw = text(record.updated_at) ?? text(record.last_updated) ?? text(record.checked_at);
  if (raw && !Number.isNaN(new Date(raw).valueOf())) return new Date(raw).toISOString();
  return new Date().toISOString();
}

function pdlEndpoint(sandbox: boolean): string {
  return sandbox
    ? "https://sandbox.api.peopledatalabs.com/v5/person/search"
    : "https://api.peopledatalabs.com/v5/person/search";
}

@Injectable()
export class PeopleDataLabsCandidateSourceProvider {
  readonly sourceType = ApprovedSourceTypes.ApprovedExternal;
  readonly providerKey = "people_data_labs" as const;
  readonly requiresApproval = true as const;

  constructor(private readonly connections: ExternalSourceConnectionService) {}

  isConfiguredFor(organizationId: string): Promise<boolean> {
    return this.connections.isConfiguredFor(organizationId, this.providerKey);
  }

  async search(request: CandidateSourceSearchRequest): Promise<CandidateSourceResult[]> {
    const connection = await this.connections.require(request.organizationId, this.providerKey);
    const apiKey = this.connections.apiKey(connection);
    const limit = Math.max(1, Math.min(100, Math.floor(request.limit)));
    const response = await externalSourceFetch(
      this.providerKey,
      pdlEndpoint(connection.config.sandbox === true),
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({
          size: limit,
          titlecase: true,
          query: {
            bool: {
              should: [
                { match: { job_title: { query: request.query, operator: "and" } } },
                { match: { job_company_name: { query: request.query, operator: "and" } } },
                { match: { skills: { query: request.query, operator: "and" } } },
                { match: { location_name: { query: request.query, operator: "and" } } },
              ],
              minimum_should_match: 1,
            },
          },
        }),
      },
    );
    assertExternalSourceResponse(response, this.providerKey);
    const payload = await response.json() as unknown;
    return records(payload).slice(0, limit).flatMap((record) => {
      const externalKey = record.id === undefined ? undefined : String(record.id);
      const displayName = text(record.full_name);
      if (!externalKey || !displayName) return [];
      const currentRole = text(record.job_title);
      const currentCompany = text(record.job_company_name);
      const skills = textList(record.skills);
      const location = text(record.location_name);
      const sourceUrl = text(record.linkedin_url);
      const email = text(record.work_email);
      const retrievedAt = new Date().toISOString();
      const evidenceSummary = [
        currentRole ? `Current role: ${currentRole}` : undefined,
        currentCompany ? `Current company: ${currentCompany}` : undefined,
        location ? `Location: ${location}` : undefined,
      ].filter((item): item is string => Boolean(item));
      return [{
        sourceType: this.sourceType,
        sourceExternalKey: externalKey,
        displayName,
        ...(currentRole ? { currentRole } : {}),
        ...(currentCompany ? { currentCompany } : {}),
        skills,
        retrievalScore: retrievalScore(request.query, [displayName, currentRole, currentCompany, location, ...skills]),
        evidenceSummary,
        ...(email ? { normalizedIdentity: { email } } : {}),
        provenance: {
          providerKey: this.providerKey,
          sourceType: this.sourceType,
          observedAt: observedAt(record),
          retrievedAt,
          externalKey,
          ...(sourceUrl ? { sourceUrl } : {}),
          evidenceReferences: [`people_data_labs:person:${externalKey}`],
        },
      } satisfies CandidateSourceResult];
    });
  }
}

const CORESIGNAL_PREVIEW_URL = "https://api.coresignal.com/cdapi/v2/employee_multi_source/search/es_dsl/preview";

@Injectable()
export class CoresignalCandidateSourceProvider {
  readonly sourceType = ApprovedSourceTypes.ApprovedExternal;
  readonly providerKey = "coresignal" as const;
  readonly requiresApproval = true as const;

  constructor(private readonly connections: ExternalSourceConnectionService) {}

  isConfiguredFor(organizationId: string): Promise<boolean> {
    return this.connections.isConfiguredFor(organizationId, this.providerKey);
  }

  async search(request: CandidateSourceSearchRequest): Promise<CandidateSourceResult[]> {
    const connection = await this.connections.require(request.organizationId, this.providerKey);
    const apiKey = this.connections.apiKey(connection);
    const limit = Math.max(1, Math.min(25, Math.floor(request.limit)));
    const response = await externalSourceFetch(
      this.providerKey,
      `${CORESIGNAL_PREVIEW_URL}?page=1`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          apikey: apiKey,
        },
        body: JSON.stringify({
          query: {
            bool: {
              should: [
                { query_string: { query: request.query, default_field: "summary", default_operator: "and" } },
                { query_string: { query: request.query, default_field: "headline", default_operator: "and" } },
                { query_string: { query: request.query, default_field: "active_experience_title", default_operator: "and" } },
                { query_string: { query: request.query, default_field: "company_name", default_operator: "and" } },
              ],
              minimum_should_match: 1,
            },
          },
          sort: ["_score"],
        }),
      },
    );
    assertExternalSourceResponse(response, this.providerKey);
    const payload = await response.json() as unknown;
    return records(payload).slice(0, limit).flatMap((record) => {
      const externalKey = record.id === undefined ? undefined : String(record.id);
      const displayName = text(record.full_name);
      if (!externalKey || !displayName) return [];
      const currentRole = text(record.active_experience_title) ?? text(record.headline);
      const currentCompany = text(record.company_name);
      const location = text(record.location_full);
      const sourceUrl = text(record.professional_network_url);
      const retrievedAt = new Date().toISOString();
      const evidenceSummary = [
        currentRole ? `Current role: ${currentRole}` : undefined,
        currentCompany ? `Current company: ${currentCompany}` : undefined,
        location ? `Location: ${location}` : undefined,
      ].filter((item): item is string => Boolean(item));
      return [{
        sourceType: this.sourceType,
        sourceExternalKey: externalKey,
        displayName,
        ...(currentRole ? { currentRole } : {}),
        ...(currentCompany ? { currentCompany } : {}),
        skills: [],
        retrievalScore: retrievalScore(request.query, [displayName, currentRole, currentCompany, location]),
        evidenceSummary,
        provenance: {
          providerKey: this.providerKey,
          sourceType: this.sourceType,
          observedAt: observedAt(record),
          retrievedAt,
          externalKey,
          ...(sourceUrl ? { sourceUrl } : {}),
          evidenceReferences: [`coresignal:employee:${externalKey}`],
        },
      } satisfies CandidateSourceResult];
    });
  }
}

export const ExternalSourceProviderKeys: readonly ExternalSourceProviderKey[] = ["people_data_labs", "coresignal"];

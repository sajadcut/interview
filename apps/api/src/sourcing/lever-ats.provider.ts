import { Injectable } from "@nestjs/common";
import { ApprovedSourceTypes, type CandidateSourceResult } from "./candidate-source.adapter";
import { AtsConnectionService } from "./ats-connection.service";
import { assertAtsResponse, AtsProviderError, atsFetch, atsHttpOptions } from "./ats-http";
import type {
  AtsConnection,
  AtsExportCandidate,
  AtsExportResult,
  AtsJob,
  AtsProvider,
  AtsStageUpdate,
} from "./ats-provider.contracts";

function baseUrl(connection: AtsConnection): string {
  const override = process.env.LEVER_ATS_API_BASE_URL?.trim();
  if (override) return override.replace(/\/$/, "");
  return connection.config.region === "eu"
    ? "https://api.eu.lever.co/v1"
    : "https://api.lever.co/v1";
}

function records(payload: unknown): Record<string, unknown>[] {
  if (!payload || typeof payload !== "object") return [];
  const data = (payload as Record<string, unknown>).data;
  return Array.isArray(data)
    ? data.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
    : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(stringValue).filter((entry): entry is string => Boolean(entry)) : [];
}

function contact(opportunity: Record<string, unknown>): Record<string, unknown> {
  return opportunity.contact && typeof opportunity.contact === "object"
    ? opportunity.contact as Record<string, unknown>
    : opportunity;
}

function opportunityName(opportunity: Record<string, unknown>): string {
  const profile = contact(opportunity);
  return stringValue(profile.name)
    ?? stringValue(opportunity.name)
    ?? `Lever opportunity ${String(opportunity.id ?? "unknown")}`;
}

function opportunityEmails(opportunity: Record<string, unknown>): string[] {
  const profile = contact(opportunity);
  return strings(profile.emails ?? opportunity.emails);
}

function opportunityPhone(opportunity: Record<string, unknown>): string | undefined {
  const profile = contact(opportunity);
  const phones = Array.isArray(profile.phones) ? profile.phones : Array.isArray(opportunity.phones) ? opportunity.phones : [];
  for (const phone of phones) {
    if (typeof phone === "string" && phone.trim()) return phone.trim();
    if (phone && typeof phone === "object" && stringValue((phone as Record<string, unknown>).value)) {
      return stringValue((phone as Record<string, unknown>).value);
    }
  }
  return undefined;
}

function opportunityMatches(opportunity: Record<string, unknown>, query: string): boolean {
  const profile = contact(opportunity);
  const haystack = [
    opportunityName(opportunity),
    ...opportunityEmails(opportunity),
    stringValue(profile.headline),
    stringValue(opportunity.headline),
    stringValue(profile.location),
    stringValue(opportunity.location),
  ].filter(Boolean).join(" ").toLocaleLowerCase();
  return haystack.includes(query.trim().toLocaleLowerCase());
}

function responseData(payload: unknown): Record<string, unknown> | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const data = (payload as Record<string, unknown>).data;
  return data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : undefined;
}

@Injectable()
export class LeverAtsProvider implements AtsProvider {
  readonly sourceType = ApprovedSourceTypes.Ats;
  readonly providerKey = "lever" as const;
  readonly requiresApproval = true as const;

  constructor(private readonly connections: AtsConnectionService) {}

  async isConfiguredFor(organizationId: string): Promise<boolean> {
    const connection = await this.connections.find(organizationId, this.providerKey);
    if (!connection) return false;
    try {
      this.connections.lever(connection);
      return true;
    } catch {
      return false;
    }
  }

  async verify(organizationId: string) {
    const connection = await this.connections.require(organizationId, this.providerKey);
    const response = await this.request(connection, `${baseUrl(connection)}/opportunities?limit=1`, { method: "GET" });
    assertAtsResponse(response, this.providerKey);
    return { provider: this.providerKey, ready: true as const };
  }

  async search(request: { organizationId: string; jobId: string; query: string; limit: number }): Promise<CandidateSourceResult[]> {
    const connection = await this.connections.require(request.organizationId, this.providerKey);
    const emailQuery = /^\S+@\S+\.\S+$/.test(request.query.trim()) ? request.query.trim() : undefined;
    const results: CandidateSourceResult[] = [];
    const maxPages = Math.max(1, Math.min(10, Number(process.env.ATS_SEARCH_MAX_PAGES ?? 5) || 5));
    let offset: string | undefined;

    for (let page = 0; page < maxPages && results.length < request.limit; page += 1) {
      const query = new URLSearchParams({ limit: String(Math.min(100, Math.max(request.limit, 25))), expand: "contact,stage" });
      if (emailQuery) query.set("email", emailQuery);
      if (offset) query.set("offset", offset);
      const response = await this.request(connection, `${baseUrl(connection)}/opportunities?${query}`, { method: "GET" });
      assertAtsResponse(response, this.providerKey);
      const payload = await response.json() as Record<string, unknown>;
      for (const opportunity of records(payload)) {
        if (!emailQuery && !opportunityMatches(opportunity, request.query)) continue;
        const id = String(opportunity.id ?? "");
        if (!id) continue;
        const profile = contact(opportunity);
        const email = opportunityEmails(opportunity)[0];
        const phone = opportunityPhone(opportunity);
        const stage = opportunity.stage && typeof opportunity.stage === "object"
          ? stringValue((opportunity.stage as Record<string, unknown>).text)
          : stringValue(opportunity.stage);
        results.push({
          sourceType: this.sourceType,
          sourceExternalKey: id,
          displayName: opportunityName(opportunity),
          ...(stringValue(profile.headline) ?? stringValue(opportunity.headline)
            ? { currentRole: stringValue(profile.headline) ?? stringValue(opportunity.headline) }
            : {}),
          skills: [],
          retrievalScore: emailQuery ? 1 : 0.75,
          evidenceSummary: [
            "Opportunity profile retrieved from Lever.",
            ...(stage ? [`Current Lever stage: ${stage}`] : []),
          ],
          ...((email || phone) ? { normalizedIdentity: { ...(email ? { email } : {}), ...(phone ? { phone } : {}) } } : {}),
          provenance: {
            providerKey: this.providerKey,
            sourceType: this.sourceType,
            observedAt: new Date(Number(opportunity.updatedAt ?? opportunity.createdAt ?? Date.now())).toISOString(),
            retrievedAt: new Date().toISOString(),
            externalKey: id,
            evidenceReferences: [`lever:opportunity:${id}`],
          },
        });
        if (results.length >= request.limit) break;
      }
      if (emailQuery || payload.hasNext !== true || !stringValue(payload.next)) break;
      offset = stringValue(payload.next);
    }
    return results;
  }

  async listJobs(organizationId: string, limit: number): Promise<AtsJob[]> {
    const connection = await this.connections.require(organizationId, this.providerKey);
    const response = await this.request(
      connection,
      `${baseUrl(connection)}/postings?limit=${Math.max(1, Math.min(100, limit))}`,
      { method: "GET" },
    );
    assertAtsResponse(response, this.providerKey);
    return records(await response.json()).map((posting) => {
      const categories = posting.categories && typeof posting.categories === "object"
        ? posting.categories as Record<string, unknown>
        : {};
      const urls = posting.urls && typeof posting.urls === "object" ? posting.urls as Record<string, unknown> : {};
      return {
        provider: this.providerKey,
        externalId: String(posting.id ?? ""),
        title: stringValue(posting.text) ?? `Lever posting ${String(posting.id ?? "")}`,
        status: stringValue(posting.state) ?? "unknown",
        ...(stringValue(categories.location) ? { location: stringValue(categories.location) } : {}),
        ...(stringValue(categories.department) ? { department: stringValue(categories.department) } : {}),
        ...(stringValue(urls.show) ? { sourceUrl: stringValue(urls.show) } : {}),
      };
    }).filter((job) => Boolean(job.externalId));
  }

  async exportApplication(organizationId: string, input: AtsExportCandidate): Promise<AtsExportResult> {
    const connection = await this.connections.require(organizationId, this.providerKey);
    const credentials = this.connections.lever(connection);
    if (!credentials.performAs) {
      throw new AtsProviderError(
        `Lever opportunity creation requires ${connection.credentialReference}_PERFORM_AS to identify the acting Lever user`,
        "LEVER_PERFORM_AS_REQUIRED",
        false,
      );
    }

    if (input.primaryEmail) {
      const query = new URLSearchParams({ email: input.primaryEmail, posting_id: input.providerJobReference, limit: "100", expand: "contact" });
      const existingResponse = await this.request(connection, `${baseUrl(connection)}/opportunities?${query}`, { method: "GET" });
      assertAtsResponse(existingResponse, this.providerKey);
      const existing = records(await existingResponse.json())[0];
      if (existing?.id) {
        const existingContact = contact(existing);
        return {
          provider: this.providerKey,
          providerCandidateReference: String(existingContact.id ?? existing.contact ?? existing.id),
          providerApplicationReference: String(existing.id),
          providerJobReference: input.providerJobReference,
          deduplicated: true,
        };
      }
    }

    const query = new URLSearchParams({ perform_as: credentials.performAs });
    const sourceName = stringValue(connection.config.sourceName) ?? "Interview Platform";
    const response = await this.request(
      connection,
      `${baseUrl(connection)}/opportunities?${query}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: input.displayName,
          ...(input.primaryEmail ? { emails: [input.primaryEmail] } : {}),
          ...(input.primaryPhone ? { phones: [{ value: input.primaryPhone, type: "mobile" }] } : {}),
          ...((input.currentRole || input.currentCompany)
            ? { headline: [input.currentRole, input.currentCompany].filter(Boolean).join(" · ") }
            : {}),
          postings: [input.providerJobReference],
          origin: "sourced",
          sources: [sourceName],
        }),
      },
      false,
    );
    assertAtsResponse(response, this.providerKey);
    const created = responseData(await response.json());
    const opportunityId = created?.id ? String(created.id) : "";
    if (!opportunityId) {
      throw new AtsProviderError("Lever create-opportunity response did not contain an id", "LEVER_OPPORTUNITY_RESPONSE_INVALID", false);
    }
    return {
      provider: this.providerKey,
      providerCandidateReference: String(created?.contact ?? opportunityId),
      providerApplicationReference: opportunityId,
      providerJobReference: input.providerJobReference,
      deduplicated: false,
    };
  }

  async updateStage(organizationId: string, input: AtsStageUpdate): Promise<void> {
    const connection = await this.connections.require(organizationId, this.providerKey);
    const credentials = this.connections.lever(connection);
    const query = new URLSearchParams();
    if (credentials.performAs) query.set("perform_as", credentials.performAs);
    const suffix = query.size ? `?${query}` : "";
    const response = await this.request(
      connection,
      `${baseUrl(connection)}/opportunities/${encodeURIComponent(input.providerApplicationReference)}/stage${suffix}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stage: input.targetStageReference }),
      },
    );
    assertAtsResponse(response, this.providerKey);
  }

  private async request(
    connection: AtsConnection,
    url: string,
    init: RequestInit,
    idempotent = true,
  ): Promise<Response> {
    const credentials = this.connections.lever(connection);
    const authorization = Buffer.from(`${credentials.apiKey}:`).toString("base64");
    return atsFetch(
      this.providerKey,
      url,
      {
        ...init,
        headers: { ...(init.headers ?? {}), authorization: `Basic ${authorization}` },
      },
      atsHttpOptions(),
      { idempotent },
    );
  }
}

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

interface TokenCacheEntry {
  token: string;
  expiresAt: number;
}

function apiBase(): string {
  return (process.env.GREENHOUSE_ATS_API_BASE_URL?.trim() || "https://harvest.greenhouse.io/v3").replace(/\/$/, "");
}

function tokenUrl(): string {
  return process.env.GREENHOUSE_ATS_TOKEN_URL?.trim() || "https://auth.greenhouse.io/token";
}

function list(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object");
  if (value && typeof value === "object" && Array.isArray((value as Record<string, unknown>).data)) {
    return ((value as Record<string, unknown>).data as unknown[]).filter(
      (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object",
    );
  }
  return [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function contactValue(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const entry = value as Record<string, unknown>;
  return stringValue(entry.value) ?? stringValue(entry.email) ?? stringValue(entry.address) ?? stringValue(entry.number);
}

function candidateEmail(candidate: Record<string, unknown>): string | undefined {
  const values = Array.isArray(candidate.email_addresses) ? candidate.email_addresses : [];
  return values.map(contactValue).find(Boolean);
}

function candidatePhone(candidate: Record<string, unknown>): string | undefined {
  const values = Array.isArray(candidate.phone_numbers) ? candidate.phone_numbers : [];
  return values.map(contactValue).find(Boolean);
}

function displayName(candidate: Record<string, unknown>): string {
  const preferred = stringValue(candidate.preferred_name);
  const first = preferred ?? stringValue(candidate.first_name) ?? "";
  const last = stringValue(candidate.last_name) ?? "";
  return `${first} ${last}`.trim() || `Greenhouse candidate ${String(candidate.id ?? "unknown")}`;
}

function candidateMatches(candidate: Record<string, unknown>, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  const fields = [
    displayName(candidate),
    candidateEmail(candidate),
    stringValue(candidate.company),
    stringValue(candidate.title),
  ].filter(Boolean).join(" ").toLocaleLowerCase();
  return fields.includes(normalized);
}

function nextLink(response: Response): string | undefined {
  const raw = response.headers.get("link") ?? "";
  for (const segment of raw.split(",")) {
    const match = segment.match(/<([^>]+)>;\s*rel="?next"?/i);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

function splitGreenhouseName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) {
    throw new AtsProviderError(
      "Greenhouse requires both first_name and last_name; the local candidate display name must contain at least two name parts before export",
      "GREENHOUSE_LAST_NAME_REQUIRED",
      false,
    );
  }
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts.at(-1) ?? "" };
}

@Injectable()
export class GreenhouseAtsProvider implements AtsProvider {
  readonly sourceType = ApprovedSourceTypes.Ats;
  readonly providerKey = "greenhouse" as const;
  readonly requiresApproval = true as const;
  private readonly tokens = new Map<string, TokenCacheEntry>();

  constructor(private readonly connections: AtsConnectionService) {}

  async isConfiguredFor(organizationId: string): Promise<boolean> {
    const connection = await this.connections.find(organizationId, this.providerKey);
    if (!connection) return false;
    try {
      this.connections.greenhouse(connection);
      return true;
    } catch {
      return false;
    }
  }

  async verify(organizationId: string) {
    const connection = await this.connections.require(organizationId, this.providerKey);
    const response = await this.authorized(connection, `${apiBase()}/jobs?per_page=1`, { method: "GET" });
    assertAtsResponse(response, this.providerKey);
    return { provider: this.providerKey, ready: true as const };
  }

  async search(request: { organizationId: string; jobId: string; query: string; limit: number }): Promise<CandidateSourceResult[]> {
    const connection = await this.connections.require(request.organizationId, this.providerKey);
    const results: CandidateSourceResult[] = [];
    const emailQuery = /^\S+@\S+\.\S+$/.test(request.query.trim()) ? request.query.trim() : undefined;
    const perPage = Math.min(100, Math.max(request.limit, 25));
    const maxPages = Math.max(1, Math.min(10, Number(process.env.ATS_SEARCH_MAX_PAGES ?? 5) || 5));
    let url = `${apiBase()}/candidates?per_page=${perPage}${emailQuery ? `&email=${encodeURIComponent(emailQuery)}` : ""}`;

    for (let page = 0; page < maxPages && results.length < request.limit; page += 1) {
      const response = await this.authorized(connection, url, { method: "GET" });
      assertAtsResponse(response, this.providerKey);
      const payload = await response.json() as unknown;
      for (const candidate of list(payload)) {
        if (!emailQuery && !candidateMatches(candidate, request.query)) continue;
        const id = String(candidate.id ?? "");
        if (!id) continue;
        const email = candidateEmail(candidate);
        const phone = candidatePhone(candidate);
        const observedAt = stringValue(candidate.updated_at) ?? stringValue(candidate.created_at) ?? new Date().toISOString();
        results.push({
          sourceType: this.sourceType,
          sourceExternalKey: id,
          displayName: displayName(candidate),
          ...(stringValue(candidate.title) ? { currentRole: stringValue(candidate.title) } : {}),
          ...(stringValue(candidate.company) ? { currentCompany: stringValue(candidate.company) } : {}),
          skills: [],
          retrievalScore: emailQuery ? 1 : 0.75,
          evidenceSummary: ["Candidate profile retrieved from Greenhouse Harvest v3."],
          ...((email || phone) ? { normalizedIdentity: { ...(email ? { email } : {}), ...(phone ? { phone } : {}) } } : {}),
          provenance: {
            providerKey: this.providerKey,
            sourceType: this.sourceType,
            observedAt,
            retrievedAt: new Date().toISOString(),
            externalKey: id,
            evidenceReferences: [`greenhouse:candidate:${id}`],
          },
        });
        if (results.length >= request.limit) break;
      }
      const next = nextLink(response);
      if (!next || emailQuery) break;
      const parsed = new URL(next);
      if (parsed.origin !== new URL(apiBase()).origin) {
        throw new AtsProviderError("Greenhouse pagination returned an unexpected origin", "GREENHOUSE_PAGINATION_ORIGIN", false);
      }
      url = next;
    }
    return results;
  }

  async listJobs(organizationId: string, limit: number): Promise<AtsJob[]> {
    const connection = await this.connections.require(organizationId, this.providerKey);
    const response = await this.authorized(
      connection,
      `${apiBase()}/jobs?status=open&per_page=${Math.max(1, Math.min(500, limit))}`,
      { method: "GET" },
    );
    assertAtsResponse(response, this.providerKey);
    return list(await response.json()).map((job) => ({
      provider: this.providerKey,
      externalId: String(job.id ?? ""),
      title: stringValue(job.name) ?? stringValue(job.title) ?? `Greenhouse job ${String(job.id ?? "")}`,
      status: stringValue(job.status) ?? "unknown",
      ...(job.department && typeof job.department === "object" && stringValue((job.department as Record<string, unknown>).name)
        ? { department: stringValue((job.department as Record<string, unknown>).name) }
        : {}),
    })).filter((job) => Boolean(job.externalId));
  }

  async exportApplication(organizationId: string, input: AtsExportCandidate): Promise<AtsExportResult> {
    const connection = await this.connections.require(organizationId, this.providerKey);
    const jobId = Number(input.providerJobReference);
    if (!Number.isSafeInteger(jobId) || jobId <= 0) {
      throw new AtsProviderError("Greenhouse job reference must be a numeric Harvest job id", "GREENHOUSE_INVALID_JOB_REFERENCE", false);
    }

    let candidateId: number | undefined;
    let deduplicated = false;
    if (input.primaryEmail) {
      const response = await this.authorized(
        connection,
        `${apiBase()}/candidates?email=${encodeURIComponent(input.primaryEmail)}&per_page=50`,
        { method: "GET" },
      );
      assertAtsResponse(response, this.providerKey);
      const match = list(await response.json())[0];
      const parsed = Number(match?.id);
      if (Number.isSafeInteger(parsed) && parsed > 0) {
        candidateId = parsed;
        deduplicated = true;
      }
    }

    if (!candidateId) {
      const name = splitGreenhouseName(input.displayName);
      const response = await this.authorized(
        connection,
        `${apiBase()}/candidates`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            first_name: name.firstName,
            last_name: name.lastName,
            ...(input.currentCompany ? { company: input.currentCompany } : {}),
            ...(input.currentRole ? { title: input.currentRole } : {}),
            ...(input.primaryEmail ? { email_addresses: [{ value: input.primaryEmail, type: "personal" }] } : {}),
            ...(input.primaryPhone ? { phone_numbers: [{ value: input.primaryPhone, type: "mobile" }] } : {}),
            application: { job_id: jobId },
          }),
        },
        false,
      );
      assertAtsResponse(response, this.providerKey);
      const created = await response.json() as Record<string, unknown>;
      const parsed = Number(created.id);
      if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new AtsProviderError("Greenhouse create-candidate response did not contain an id", "GREENHOUSE_CANDIDATE_RESPONSE_INVALID", false);
      }
      candidateId = parsed;
    }

    const existingApplication = await this.findApplication(connection, candidateId, jobId);
    let applicationId = existingApplication;
    if (!applicationId) {
      const response = await this.authorized(
        connection,
        `${apiBase()}/applications`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ candidate_id: candidateId, job_id: jobId }),
        },
        false,
      );
      assertAtsResponse(response, this.providerKey);
      const created = await response.json() as Record<string, unknown>;
      applicationId = String(created.id ?? "");
      if (!applicationId) {
        throw new AtsProviderError("Greenhouse create-application response did not contain an id", "GREENHOUSE_APPLICATION_RESPONSE_INVALID", false);
      }
    } else {
      deduplicated = true;
    }

    return {
      provider: this.providerKey,
      providerCandidateReference: String(candidateId),
      providerApplicationReference: applicationId,
      providerJobReference: String(jobId),
      deduplicated,
    };
  }

  async updateStage(organizationId: string, input: AtsStageUpdate): Promise<void> {
    if (!input.currentStageReference) {
      throw new AtsProviderError("Greenhouse stage moves require the current stage id as a stale-write guard", "GREENHOUSE_CURRENT_STAGE_REQUIRED", false);
    }
    const fromStage = Number(input.currentStageReference);
    const toStage = Number(input.targetStageReference);
    if (!Number.isSafeInteger(fromStage) || !Number.isSafeInteger(toStage)) {
      throw new AtsProviderError("Greenhouse stage references must be numeric ids", "GREENHOUSE_INVALID_STAGE_REFERENCE", false);
    }
    const connection = await this.connections.require(organizationId, this.providerKey);
    const response = await this.authorized(
      connection,
      `${apiBase()}/applications/${encodeURIComponent(input.providerApplicationReference)}/move`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from_stage_id: fromStage, to_stage_id: toStage }),
      },
      false,
    );
    assertAtsResponse(response, this.providerKey);
  }

  private async findApplication(connection: AtsConnection, candidateId: number, jobId: number): Promise<string | undefined> {
    const response = await this.authorized(
      connection,
      `${apiBase()}/applications?candidate_ids=${candidateId}&job_ids=${jobId}&per_page=50`,
      { method: "GET" },
    );
    assertAtsResponse(response, this.providerKey);
    const row = list(await response.json())[0];
    return row?.id !== undefined ? String(row.id) : undefined;
  }

  private async accessToken(connection: AtsConnection, force = false): Promise<string> {
    const cached = this.tokens.get(connection.id);
    if (!force && cached && cached.expiresAt > Date.now() + 30_000) return cached.token;
    const credentials = this.connections.greenhouse(connection);
    const authorization = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString("base64");
    const response = await atsFetch(
      "greenhouse-auth",
      tokenUrl(),
      {
        method: "POST",
        headers: {
          authorization: `Basic ${authorization}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          ...(credentials.subject ? { sub: credentials.subject } : {}),
        }),
      },
      atsHttpOptions(),
    );
    assertAtsResponse(response, "greenhouse-auth");
    const body = await response.json() as { access_token?: string; expires_in?: number };
    if (!body.access_token) {
      throw new AtsProviderError("Greenhouse OAuth response did not contain an access token", "GREENHOUSE_TOKEN_RESPONSE_INVALID", false);
    }
    this.tokens.set(connection.id, {
      token: body.access_token,
      expiresAt: Date.now() + Math.max(30, Number(body.expires_in ?? 3600) - 30) * 1_000,
    });
    return body.access_token;
  }

  private async authorized(
    connection: AtsConnection,
    url: string,
    init: RequestInit,
    idempotent = true,
  ): Promise<Response> {
    const execute = async (force: boolean) => {
      const token = await this.accessToken(connection, force);
      return atsFetch(
        this.providerKey,
        url,
        {
          ...init,
          headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` },
        },
        atsHttpOptions(),
        { idempotent },
      );
    };
    const response = await execute(false);
    if (response.status !== 401) return response;
    this.tokens.delete(connection.id);
    return execute(true);
  }
}

import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { ExternalSourceProviderError } from "./external-source-http";

export type ExternalSourceProviderKey = "people_data_labs" | "coresignal";

export interface ExternalSourceConnection {
  id: string;
  organizationId: string;
  providerKey: ExternalSourceProviderKey;
  status: string;
  credentialReference: string;
  config: Record<string, unknown>;
}

const ENV_REFERENCE = /^env:\/\/([A-Z][A-Z0-9_]{2,100})$/;

export function externalSourceProviderKey(value: string): ExternalSourceProviderKey {
  const normalized = value.trim().toLowerCase();
  if (normalized === "people_data_labs" || normalized === "coresignal") return normalized;
  throw new BadRequestException("External candidate source provider must be people_data_labs or coresignal");
}

function approvedForRecruiting(config: Record<string, unknown>): boolean {
  return config.approvedForRecruitingUse === true && config.privacyUseApproved === true;
}

@Injectable()
export class ExternalSourceConnectionService {
  constructor(private readonly database: DatabaseService) {}

  async find(organizationId: string, providerKey: ExternalSourceProviderKey): Promise<ExternalSourceConnection | null> {
    const rows = await this.database.sql`
      SELECT id::text, provider_key, status, credential_reference, config
      FROM integration_connections
      WHERE organization_id = ${organizationId}::uuid
        AND provider_key = ${providerKey}
        AND connection_type = 'candidate_source'
        AND status <> 'disabled'
      LIMIT 1
    `;
    const row = rows[0];
    if (!row?.credential_reference) return null;
    return {
      id: String(row.id),
      organizationId,
      providerKey,
      status: String(row.status),
      credentialReference: String(row.credential_reference),
      config: row.config && typeof row.config === "object" ? row.config as Record<string, unknown> : {},
    };
  }

  async require(organizationId: string, providerKey: ExternalSourceProviderKey): Promise<ExternalSourceConnection> {
    const connection = await this.find(organizationId, providerKey);
    if (!connection) throw new NotFoundException(`${providerKey} candidate source is not configured for this organization`);
    if (!approvedForRecruiting(connection.config)) {
      throw new ExternalSourceProviderError(
        `${providerKey} requires approvedForRecruitingUse=true and privacyUseApproved=true in integration config before candidate data can be retrieved`,
        "EXTERNAL_SOURCE_USAGE_NOT_APPROVED",
        false,
      );
    }
    return connection;
  }

  apiKey(connection: ExternalSourceConnection): string {
    const match = ENV_REFERENCE.exec(connection.credentialReference);
    if (!match?.[1]) {
      throw new BadRequestException(
        "This runtime resolves candidate-source credentials only from env://PREFIX references; vault://, secret:// and external:// require a deployed secret-resolver adapter",
      );
    }
    const apiKey = process.env[`${match[1]}_API_KEY`] ?? "";
    if (!apiKey.trim()) {
      throw new ExternalSourceProviderError(
        `${connection.providerKey} API key referenced by ${connection.credentialReference} is unavailable`,
        "EXTERNAL_SOURCE_CREDENTIALS_UNAVAILABLE",
        false,
      );
    }
    return apiKey.trim();
  }

  async isConfiguredFor(organizationId: string, providerKey: ExternalSourceProviderKey): Promise<boolean> {
    const connection = await this.find(organizationId, providerKey);
    if (!connection || !approvedForRecruiting(connection.config)) return false;
    try {
      this.apiKey(connection);
      return true;
    } catch {
      return false;
    }
  }
}

import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { AtsProviderError } from "./ats-http";
import type { AtsConnection, AtsProviderKey } from "./ats-provider.contracts";

const ENV_REFERENCE = /^env:\/\/([A-Z][A-Z0-9_]{2,100})$/;

export interface GreenhouseCredentials {
  clientId: string;
  clientSecret: string;
  subject?: string;
}

export interface LeverCredentials {
  apiKey: string;
  performAs?: string;
}

@Injectable()
export class AtsConnectionService {
  constructor(private readonly database: DatabaseService) {}

  async find(organizationId: string, providerKey: AtsProviderKey): Promise<AtsConnection | null> {
    const rows = await this.database.sql`
      SELECT id::text, provider_key, status, credential_reference, config
      FROM integration_connections
      WHERE organization_id = ${organizationId}::uuid
        AND provider_key = ${providerKey}
        AND connection_type = 'ats'
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
      config: row.config && typeof row.config === "object"
        ? (row.config as Record<string, unknown>)
        : {},
    };
  }

  async require(organizationId: string, providerKey: AtsProviderKey): Promise<AtsConnection> {
    const connection = await this.find(organizationId, providerKey);
    if (!connection) {
      throw new NotFoundException(
        `${providerKey} ATS connection is not configured for this organization`,
      );
    }
    return connection;
  }

  greenhouse(connection: AtsConnection): GreenhouseCredentials {
    const prefix = this.envPrefix(connection);
    const clientId = process.env[`${prefix}_CLIENT_ID`]?.trim() ?? "";
    const clientSecret = process.env[`${prefix}_CLIENT_SECRET`] ?? "";
    const subject = process.env[`${prefix}_SUB`]?.trim() || undefined;
    if (!clientId || !clientSecret) {
      throw new AtsProviderError(
        `Greenhouse credentials referenced by ${connection.credentialReference} are unavailable`,
        "GREENHOUSE_CREDENTIALS_UNAVAILABLE",
        false,
      );
    }
    return { clientId, clientSecret, ...(subject ? { subject } : {}) };
  }

  lever(connection: AtsConnection): LeverCredentials {
    const prefix = this.envPrefix(connection);
    const apiKey = process.env[`${prefix}_API_KEY`] ?? "";
    const performAs = process.env[`${prefix}_PERFORM_AS`]?.trim() || undefined;
    if (!apiKey) {
      throw new AtsProviderError(
        `Lever credentials referenced by ${connection.credentialReference} are unavailable`,
        "LEVER_CREDENTIALS_UNAVAILABLE",
        false,
      );
    }
    return { apiKey, ...(performAs ? { performAs } : {}) };
  }

  private envPrefix(connection: AtsConnection): string {
    const match = ENV_REFERENCE.exec(connection.credentialReference);
    if (!match?.[1]) {
      throw new BadRequestException(
        "This runtime currently resolves ATS credentials only from env://PREFIX references; vault://, secret:// and external:// references require a deployed secret-resolver adapter",
      );
    }
    return match[1];
  }
}

import { createHash, randomUUID } from "node:crypto";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import { STORAGE_PROVIDER, type StorageProvider } from "./storage-provider";

export interface SaveFileInput {
  originalName: string;
  mimeType: string;
  data: Uint8Array;
}

@Injectable()
export class StorageService {
  constructor(
    @Inject(STORAGE_PROVIDER) private readonly provider: StorageProvider,
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async save(input: SaveFileInput): Promise<{ id: string; key: string; sha256: string }> {
    const organizationId = this.tenantContext.require().organizationId;
    const fileId = randomUUID();
    const safeName = input.originalName.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-180) || "file";
    const key = `${organizationId}/${fileId}/${safeName}`;
    const sha256 = createHash("sha256").update(input.data).digest("hex");

    await this.provider.put(key, input.data);
    try {
      await this.database.sql`
        INSERT INTO files (
          id, organization_id, storage_key, original_name, mime_type, size_bytes, sha256
        ) VALUES (
          ${fileId}::uuid,
          ${organizationId}::uuid,
          ${key},
          ${input.originalName},
          ${input.mimeType},
          ${input.data.byteLength},
          ${sha256}
        )
      `;
    } catch (error) {
      await this.provider.delete(key);
      throw error;
    }

    return { id: fileId, key, sha256 };
  }

  async getById(fileId: string): Promise<Uint8Array> {
    const metadata = await this.requireTenantFile(fileId);
    return this.provider.get(metadata.storageKey);
  }

  async createReadReferenceById(fileId: string): Promise<string> {
    const metadata = await this.requireTenantFile(fileId);
    return this.provider.createReadReference(metadata.storageKey);
  }

  private async requireTenantFile(fileId: string): Promise<{ storageKey: string }> {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      SELECT storage_key
      FROM files
      WHERE id = ${fileId}::uuid
        AND organization_id = ${organizationId}::uuid
      LIMIT 1
    `;
    const row = rows[0] as { storage_key?: unknown } | undefined;
    if (!row || typeof row.storage_key !== "string") throw new NotFoundException("File not found");
    return { storageKey: row.storage_key };
  }
}

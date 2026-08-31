import { createHash, randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
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

  get(key: string): Promise<Uint8Array> {
    return this.provider.get(key);
  }
}

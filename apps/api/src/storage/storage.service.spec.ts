import assert from "node:assert/strict";
import test from "node:test";
import { NotFoundException } from "@nestjs/common";
import type { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import type { StorageProvider } from "./storage-provider";
import { StorageService } from "./storage.service";

const organizationId = "22222222-2222-4222-8222-222222222222";
const fileId = "44444444-4444-4444-8444-444444444444";
const storageKey = `${organizationId}/${fileId}/cv.pdf`;

function databaseReturning(rows: unknown[], onValues?: (values: unknown[]) => void): DatabaseService {
  const sql = async (_strings: TemplateStringsArray, ...values: unknown[]) => {
    onValues?.(values);
    return rows;
  };
  return { sql } as unknown as DatabaseService;
}

function provider(): StorageProvider {
  return {
    put: async (key, data) => ({ key, sizeBytes: data.byteLength }),
    get: async (key) => new TextEncoder().encode(key),
    delete: async () => undefined,
    exists: async () => true,
    createReadReference: async (key) => `local://${key}`,
  };
}

test("storage retrieval scopes metadata lookup to current organization", async () => {
  const tenant = new TenantContextService();
  const service = new StorageService(
    provider(),
    databaseReturning([{ storage_key: storageKey }], (values) => {
      assert.equal(values[0], fileId);
      assert.equal(values[1], organizationId);
    }),
    tenant,
  );

  const data = await tenant.run(organizationId, () => service.getById(fileId));
  assert.equal(new TextDecoder().decode(data), storageKey);
});

test("storage retrieval does not expose a file absent from the current tenant", async () => {
  const tenant = new TenantContextService();
  const service = new StorageService(provider(), databaseReturning([]), tenant);
  await assert.rejects(
    () => tenant.run(organizationId, () => service.getById(fileId)),
    NotFoundException,
  );
});

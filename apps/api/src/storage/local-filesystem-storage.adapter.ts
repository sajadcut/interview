import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Injectable } from "@nestjs/common";
import { getEnv } from "../config/env";
import type { StorageProvider, StoredObject } from "./storage-provider";

@Injectable()
export class LocalFilesystemStorageAdapter implements StorageProvider {
  private readonly root = path.resolve(getEnv().LOCAL_STORAGE_ROOT);

  async put(key: string, data: Uint8Array): Promise<StoredObject> {
    const target = this.resolveKey(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data, { flag: "wx" });
    return { key, sizeBytes: data.byteLength };
  }

  async get(key: string): Promise<Uint8Array> {
    return readFile(this.resolveKey(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolveKey(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolveKey(key));
      return true;
    } catch {
      return false;
    }
  }

  async createReadReference(key: string): Promise<string> {
    return `local://${key}`;
  }

  private resolveKey(key: string): string {
    const normalized = key.replaceAll("\\", "/").replace(/^\/+/, "");
    const target = path.resolve(this.root, normalized);
    const prefix = `${this.root}${path.sep}`;
    if (target !== this.root && !target.startsWith(prefix)) {
      throw new Error("Unsafe storage key");
    }
    return target;
  }
}

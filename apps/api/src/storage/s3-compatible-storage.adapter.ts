import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Injectable } from "@nestjs/common";
import { getEnv } from "../config/env";
import type { StorageProvider, StoredObject } from "./storage-provider";

function normalizeObjectKey(key: string): string {
  const normalized = key.trim().replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("\0") || normalized.split("/").includes("..")) {
    throw new Error("Invalid storage key");
  }
  return normalized;
}

@Injectable()
export class S3CompatibleStorageAdapter implements StorageProvider {
  private readonly env = getEnv();
  private readonly client = new S3Client({
    region: this.env.S3_REGION,
    forcePathStyle: this.env.S3_FORCE_PATH_STYLE,
    ...(this.env.S3_ENDPOINT ? { endpoint: this.env.S3_ENDPOINT } : {}),
    ...(this.env.S3_ACCESS_KEY_ID && this.env.S3_SECRET_ACCESS_KEY
      ? {
          credentials: {
            accessKeyId: this.env.S3_ACCESS_KEY_ID,
            secretAccessKey: this.env.S3_SECRET_ACCESS_KEY,
          },
        }
      : {}),
  });

  private bucket(): string {
    if (!this.env.S3_BUCKET) throw new Error("S3_BUCKET is required for S3 storage");
    return this.env.S3_BUCKET;
  }

  async put(key: string, data: Uint8Array): Promise<StoredObject> {
    const normalized = normalizeObjectKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket(),
        Key: normalized,
        Body: data,
        ContentLength: data.byteLength,
      }),
    );
    return { key: normalized, sizeBytes: data.byteLength };
  }

  async get(key: string): Promise<Uint8Array> {
    const normalized = normalizeObjectKey(key);
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket(), Key: normalized }),
    );
    if (!result.Body) throw new Error("S3 object body is missing");
    return new Uint8Array(await result.Body.transformToByteArray());
  }

  async delete(key: string): Promise<void> {
    const normalized = normalizeObjectKey(key);
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket(), Key: normalized }),
    );
  }

  async exists(key: string): Promise<boolean> {
    const normalized = normalizeObjectKey(key);
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket(), Key: normalized }),
      );
      return true;
    } catch (error) {
      const status =
        error && typeof error === "object" && "$metadata" in error
          ? Number((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode)
          : undefined;
      if (status === 404) return false;
      throw error;
    }
  }

  async createReadReference(key: string): Promise<string> {
    const normalized = normalizeObjectKey(key);
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket(), Key: normalized }),
      { expiresIn: this.env.S3_SIGNED_URL_TTL_SECONDS },
    );
  }
}

export { normalizeObjectKey };

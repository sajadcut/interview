import { Global, Module } from "@nestjs/common";
import { getEnv } from "../config/env";
import { LocalFilesystemStorageAdapter } from "./local-filesystem-storage.adapter";
import { S3CompatibleStorageAdapter } from "./s3-compatible-storage.adapter";
import { StorageService } from "./storage.service";
import { STORAGE_PROVIDER, type StorageProvider } from "./storage-provider";

@Global()
@Module({
  providers: [
    LocalFilesystemStorageAdapter,
    S3CompatibleStorageAdapter,
    {
      provide: STORAGE_PROVIDER,
      inject: [LocalFilesystemStorageAdapter, S3CompatibleStorageAdapter],
      useFactory: (
        local: LocalFilesystemStorageAdapter,
        s3: S3CompatibleStorageAdapter,
      ): StorageProvider => (getEnv().STORAGE_PROVIDER === "s3" ? s3 : local),
    },
    StorageService,
  ],
  exports: [STORAGE_PROVIDER, StorageService],
})
export class StorageModule {}

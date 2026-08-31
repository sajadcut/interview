import { Global, Module } from "@nestjs/common";
import { LocalFilesystemStorageAdapter } from "./local-filesystem-storage.adapter";
import { StorageService } from "./storage.service";
import { STORAGE_PROVIDER } from "./storage-provider";

@Global()
@Module({
  providers: [
    LocalFilesystemStorageAdapter,
    { provide: STORAGE_PROVIDER, useExisting: LocalFilesystemStorageAdapter },
    StorageService,
  ],
  exports: [STORAGE_PROVIDER, StorageService],
})
export class StorageModule {}

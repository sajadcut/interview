export interface StoredObject {
  key: string;
  sizeBytes: number;
}

export interface StorageProvider {
  put(key: string, data: Uint8Array): Promise<StoredObject>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  createReadReference(key: string): Promise<string>;
}

export const STORAGE_PROVIDER = Symbol("STORAGE_PROVIDER");

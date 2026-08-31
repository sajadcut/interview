import { AsyncLocalStorage } from "node:async_hooks";
import { Injectable } from "@nestjs/common";

export interface TenantContextValue {
  organizationId: string;
}

@Injectable()
export class TenantContextService {
  private readonly storage = new AsyncLocalStorage<TenantContextValue>();

  run<T>(organizationId: string | undefined, callback: () => T): T {
    if (!organizationId) return callback();
    return this.storage.run({ organizationId }, callback);
  }

  getOptional(): TenantContextValue | undefined {
    return this.storage.getStore();
  }

  require(): TenantContextValue {
    const context = this.getOptional();
    if (!context) {
      throw new Error("Tenant context is required for this operation");
    }
    return context;
  }
}

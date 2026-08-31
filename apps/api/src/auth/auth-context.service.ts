import { AsyncLocalStorage } from "node:async_hooks";
import { Injectable } from "@nestjs/common";
import type { Permission } from "./permissions";

export interface AuthPrincipal {
  userId: string;
  permissions: ReadonlySet<Permission>;
}

@Injectable()
export class AuthContextService {
  private readonly storage = new AsyncLocalStorage<AuthPrincipal>();

  run<T>(principal: AuthPrincipal | undefined, callback: () => T): T {
    if (!principal) return callback();
    return this.storage.run(principal, callback);
  }

  getOptional(): AuthPrincipal | undefined {
    return this.storage.getStore();
  }
}

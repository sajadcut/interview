import { AsyncLocalStorage } from "node:async_hooks";
import { Injectable } from "@nestjs/common";

export interface AuthPrincipal {
  userId: string;
  sessionId?: string;
  source: "development-header" | "session";
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

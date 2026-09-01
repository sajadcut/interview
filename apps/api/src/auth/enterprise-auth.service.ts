import { Injectable, UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";

import type { IdentityRole } from "./enterprise-identity.types";

@Injectable()
export class EnterpriseAuthService {
  hashToken(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }

  createSecureToken(): string {
    return randomBytes(48).toString("hex");
  }

  assertRole(role: IdentityRole, allowed: IdentityRole[]): void {
    if (!allowed.includes(role)) {
      throw new UnauthorizedException("Insufficient role permission");
    }
  }

  validateCredentialHash(storedHash: string, providedHash: string): boolean {
    return storedHash.length > 0 && storedHash === providedHash;
  }
}

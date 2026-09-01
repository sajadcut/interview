import { Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { argon2id, hash, verify } from "argon2";

@Injectable()
export class PasswordHasherService {
  async hashPassword(password: string): Promise<string> {
    return hash(password, {
      type: argon2id,
      salt: randomBytes(16),
    });
  }

  async verifyPassword(password: string, passwordHash: string): Promise<boolean> {
    return verify(passwordHash, password);
  }
}

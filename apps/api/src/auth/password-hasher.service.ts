import { Injectable } from "@nestjs/common";
import { argon2, randomBytes, timingSafeEqual } from "node:crypto";

const ARGON2_MEMORY_KIB = 65_536;
const ARGON2_PASSES = 3;
const ARGON2_PARALLELISM = 4;
const ARGON2_TAG_LENGTH = 32;
const ARGON2_VERSION = 19;

function deriveArgon2id(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2(
      "argon2id",
      {
        message: password,
        nonce: salt,
        parallelism: ARGON2_PARALLELISM,
        tagLength: ARGON2_TAG_LENGTH,
        memory: ARGON2_MEMORY_KIB,
        passes: ARGON2_PASSES,
      },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      },
    );
  });
}

@Injectable()
export class PasswordHasherService {
  async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16);
    const derivedKey = await deriveArgon2id(password, salt);
    return [
      "argon2id",
      `v=${ARGON2_VERSION}`,
      `m=${ARGON2_MEMORY_KIB},t=${ARGON2_PASSES},p=${ARGON2_PARALLELISM}`,
      salt.toString("base64url"),
      derivedKey.toString("base64url"),
    ].join("$");
  }

  async verifyPassword(password: string, encodedHash: string): Promise<boolean> {
    const [algorithm, version, parameters, encodedSalt, encodedKey, extra] = encodedHash.split("$");
    if (
      extra !== undefined ||
      algorithm !== "argon2id" ||
      version !== `v=${ARGON2_VERSION}` ||
      parameters !== `m=${ARGON2_MEMORY_KIB},t=${ARGON2_PASSES},p=${ARGON2_PARALLELISM}` ||
      !encodedSalt ||
      !encodedKey
    ) {
      return false;
    }

    try {
      const salt = Buffer.from(encodedSalt, "base64url");
      const expected = Buffer.from(encodedKey, "base64url");
      if (salt.length < 16 || expected.length !== ARGON2_TAG_LENGTH) return false;
      const actual = await deriveArgon2id(password, salt);
      return timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  }
}

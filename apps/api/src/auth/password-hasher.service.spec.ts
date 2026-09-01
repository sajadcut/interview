import assert from "node:assert/strict";
import test from "node:test";
import { PasswordHasherService } from "./password-hasher.service";

test("PasswordHasherService stores Argon2id hashes and verifies passwords", async () => {
  const service = new PasswordHasherService();
  const password = "correct horse battery staple";
  const encoded = await service.hashPassword(password);

  assert.match(encoded, /^argon2id\$v=19\$m=65536,t=3,p=4\$/);
  assert.equal(await service.verifyPassword(password, encoded), true);
  assert.equal(await service.verifyPassword("incorrect password", encoded), false);
  assert.equal(encoded.includes(password), false);
});

test("PasswordHasherService rejects malformed encoded hashes", async () => {
  const service = new PasswordHasherService();
  assert.equal(await service.verifyPassword("password", "not-an-argon2-hash"), false);
});

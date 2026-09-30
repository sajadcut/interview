import test from "node:test";
import assert from "node:assert/strict";
import { configureWorkerTls } from "./worker-tls.mjs";
test("default verifies certificates", () => {
  const env = {NODE_ENV:"development"};
  configureWorkerTls(env);
  assert.equal(env.NODE_TLS_REJECT_UNAUTHORIZED, undefined);
});
test("development explicit opt out", () => {
  const env = {NODE_ENV:"development",HTTPS_TLS_VERIFY:"false"};
  configureWorkerTls(env);
  assert.equal(env.NODE_TLS_REJECT_UNAUTHORIZED, "0");
});
test("production refuses insecure TLS overrides", () => {
  assert.throws(()=>configureWorkerTls({NODE_ENV:"production",HTTPS_TLS_VERIFY:"false"}), /forbidden/);
  assert.throws(()=>configureWorkerTls({NODE_ENV:"production",NODE_TLS_REJECT_UNAUTHORIZED:"0"}), /forbidden/);
});
test("invalid toggle rejected", () => {
  assert.throws(()=>configureWorkerTls({NODE_ENV:"test",HTTPS_TLS_VERIFY:"maybe"}), /true or false/);
});

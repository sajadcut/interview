import assert from "node:assert/strict";
import test from "node:test";
import { PrivacyWorkerApiClient } from "../src/api-client.mjs";

test("privacy worker client requires an isolated shared secret", () => {
  assert.throws(
    () => new PrivacyWorkerApiClient({ baseUrl: "http://127.0.0.1:4100", sharedSecret: "" }),
    /shared secret is required/,
  );
  const client = new PrivacyWorkerApiClient({
    baseUrl: "http://127.0.0.1:4100/",
    sharedSecret: "test-secret",
    requestTimeoutMs: 10,
  });
  assert.equal(client.baseUrl, "http://127.0.0.1:4100");
  assert.equal(client.requestTimeoutMs, 1000);
});

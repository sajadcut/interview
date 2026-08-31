import assert from "node:assert/strict";
import test from "node:test";
import { loadRootEnvironment } from "./root-env";

test("root environment loader is idempotent", () => {
  assert.doesNotThrow(() => {
    loadRootEnvironment();
    loadRootEnvironment();
  });
});

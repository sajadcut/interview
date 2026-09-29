import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canSubmitRequisitionBackedHire } from "./hiring-workflow-policy";

describe("requisition-backed hiring gate", () => {
  it("keeps legacy jobs without a requisition backward-compatible", () => {
    assert.equal(canSubmitRequisitionBackedHire(false, undefined), true);
  });

  it("requires explicit requesting-team approval when a requisition is linked", () => {
    assert.equal(canSubmitRequisitionBackedHire(true, undefined), false);
    assert.equal(canSubmitRequisitionBackedHire(true, "needs_interview"), false);
    assert.equal(canSubmitRequisitionBackedHire(true, "reject"), false);
    assert.equal(canSubmitRequisitionBackedHire(true, "approve"), true);
  });
});

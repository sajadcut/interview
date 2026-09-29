import { describe, expect, it } from "vitest";
import { canSubmitRequisitionBackedHire } from "./hiring-workflow-policy";

describe("requisition-backed hiring gate", () => {
  it("keeps legacy jobs without a requisition backward-compatible", () => {
    expect(canSubmitRequisitionBackedHire(false, undefined)).toBe(true);
  });

  it("requires explicit requesting-team approval when a requisition is linked", () => {
    expect(canSubmitRequisitionBackedHire(true, undefined)).toBe(false);
    expect(canSubmitRequisitionBackedHire(true, "needs_interview")).toBe(false);
    expect(canSubmitRequisitionBackedHire(true, "reject")).toBe(false);
    expect(canSubmitRequisitionBackedHire(true, "approve")).toBe(true);
  });
});

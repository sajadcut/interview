export function canSubmitRequisitionBackedHire(
  hasHiringRequest: boolean,
  latestTechnicalApproval: string | undefined,
): boolean {
  return !hasHiringRequest || latestTechnicalApproval === "approve";
}

export const InterviewLifecycleStages = [
  "DEV_ONLY",
  "INTERNAL_TEST",
  "SHADOW",
  "SUPERVISED_PILOT",
  "CONTROLLED_PRODUCTION",
  "SCALED_PRODUCTION",
  "SUSPENDED",
] as const;
export type InterviewLifecycleStage = (typeof InterviewLifecycleStages)[number];

export function parseInterviewLifecycleStage(value: unknown): InterviewLifecycleStage {
  if (typeof value !== "string") throw new Error("Interview lifecycle stage must be a string");
  const stage = InterviewLifecycleStages.find((candidate) => candidate === value);
  if (!stage) throw new Error(`Unsupported interview lifecycle stage: ${value}`);
  return stage;
}

export interface InterviewReleaseDecisionInput {
  lifecycleStage: InterviewLifecycleStage;
  productionApprovedAt?: string | null;
  productionApprovedByUserId?: string | null;
  candidateIsRealCustomerCandidate: boolean;
  synchronousHumanSupervisorPresent: boolean;
  approvalStatus?: string | null;
  approvedAt?: string | null;
  approvedByUserId?: string | null;
  approvalExpiresAt?: string | null;
  materialFingerprint?: string | null;
  approvedMaterialFingerprint?: string | null;
  approvalArtifactComplete?: boolean;
  now?: Date;
}

export interface InterviewReleaseDecision {
  allowed: boolean;
  mode: "development" | "shadow" | "supervised" | "autonomous" | "blocked";
  reasons: string[];
}

function productionApprovalReasons(input: InterviewReleaseDecisionInput): string[] {
  const reasons: string[] = [];
  if (input.approvalStatus !== "approved") reasons.push("Release approval artifact status is not approved");
  if (!input.approvedAt || !input.approvedByUserId) reasons.push("Release approval artifact lacks approver provenance");
  if (!input.approvalExpiresAt) {
    reasons.push("Release approval artifact lacks a review/expiry date");
  } else {
    const expiresAt = Date.parse(input.approvalExpiresAt);
    const now = (input.now ?? new Date()).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= now) reasons.push("Release approval artifact is expired");
  }
  if (!input.approvalArtifactComplete) reasons.push("Release approval artifact is incomplete");
  if (!input.materialFingerprint || !input.approvedMaterialFingerprint) {
    reasons.push("Release material fingerprint is missing");
  } else if (input.materialFingerprint !== input.approvedMaterialFingerprint) {
    reasons.push("Release material changed after approval and requires revalidation");
  }
  return reasons;
}

export function evaluateInterviewRelease(input: InterviewReleaseDecisionInput): InterviewReleaseDecision {
  if (input.lifecycleStage === "SUSPENDED" || input.approvalStatus === "suspended") {
    return { allowed: false, mode: "blocked", reasons: ["Release unit is suspended"] };
  }

  if (!input.candidateIsRealCustomerCandidate) {
    return {
      allowed: true,
      mode: input.lifecycleStage === "SHADOW" ? "shadow" : "development",
      reasons: ["Synthetic/internal candidate path is permitted for engineering validation"],
    };
  }

  if (["DEV_ONLY", "INTERNAL_TEST", "SHADOW"].includes(input.lifecycleStage)) {
    return {
      allowed: false,
      mode: "blocked",
      reasons: [`${input.lifecycleStage} does not permit autonomous real-candidate interviews`],
    };
  }

  if (input.lifecycleStage === "SUPERVISED_PILOT") {
    return input.synchronousHumanSupervisorPresent
      ? { allowed: true, mode: "supervised", reasons: ["Supervised pilot requires active trained human review ownership and pilot approval controls"] }
      : { allowed: false, mode: "blocked", reasons: ["Supervised pilot cannot run without the required human supervisor"] };
  }

  const reasons = productionApprovalReasons(input);
  if (reasons.length) return { allowed: false, mode: "blocked", reasons };
  return {
    allowed: true,
    mode: "autonomous",
    reasons: ["Release artifact is valid and unexpired; AI output remains decision support and final employment decisions stay human-controlled"],
  };
}

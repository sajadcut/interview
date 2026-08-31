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

export interface InterviewReleaseDecisionInput {
  lifecycleStage: InterviewLifecycleStage;
  productionApprovedAt: string | null;
  productionApprovedByUserId: string | null;
  candidateIsRealCustomerCandidate: boolean;
  synchronousHumanSupervisorPresent: boolean;
}

export interface InterviewReleaseDecision {
  allowed: boolean;
  mode: "development" | "shadow" | "supervised" | "autonomous" | "blocked";
  reasons: string[];
}

export function evaluateInterviewRelease(input: InterviewReleaseDecisionInput): InterviewReleaseDecision {
  if (input.lifecycleStage === "SUSPENDED") {
    return { allowed: false, mode: "blocked", reasons: ["Release unit is suspended"] };
  }

  if (!input.candidateIsRealCustomerCandidate) {
    return {
      allowed: input.lifecycleStage !== "SUSPENDED",
      mode: input.lifecycleStage === "SHADOW" ? "shadow" : "development",
      reasons: ["Synthetic/internal candidate path is permitted for engineering validation"],
    };
  }

  if (input.lifecycleStage === "DEV_ONLY" || input.lifecycleStage === "INTERNAL_TEST" || input.lifecycleStage === "SHADOW") {
    return {
      allowed: false,
      mode: "blocked",
      reasons: [`${input.lifecycleStage} does not permit autonomous real-candidate interviews`],
    };
  }

  if (input.lifecycleStage === "SUPERVISED_PILOT") {
    return input.synchronousHumanSupervisorPresent
      ? {
          allowed: true,
          mode: "supervised",
          reasons: ["Supervised pilot requires active trained human review ownership"],
        }
      : {
          allowed: false,
          mode: "blocked",
          reasons: ["Supervised pilot cannot run without the required human supervisor"],
        };
  }

  const hasProductionApproval = Boolean(input.productionApprovedAt && input.productionApprovedByUserId);
  if (!hasProductionApproval) {
    return {
      allowed: false,
      mode: "blocked",
      reasons: ["Controlled/scaled production requires an explicit production approval record"],
    };
  }

  return {
    allowed: true,
    mode: "autonomous",
    reasons: ["Release unit is production-approved; final employment decisions remain human-controlled"],
  };
}

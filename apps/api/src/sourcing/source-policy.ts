import { BadRequestException, ForbiddenException } from "@nestjs/common";
import {
  ApprovedSourceTypes,
  type ApprovedSourceType,
  type CandidateSourceAdapter,
} from "./candidate-source.adapter";

export const SOURCE_POLICY_VERSION = "source-policy-v1";

const APPROVED_SOURCE_TYPES = new Set<ApprovedSourceType>(Object.values(ApprovedSourceTypes));

export interface SourcePolicyRequest {
  sourceType: ApprovedSourceType;
  requestedLimit: number;
  adapter: CandidateSourceAdapter;
  approvalConfirmed?: boolean;
  approverUserId?: string;
}

export interface SourcePolicyDecision {
  policyVersion: string;
  sourceType: ApprovedSourceType;
  limit: number;
  requiresApproval: boolean;
  approvedByUserId?: string;
}

export function evaluateSourcePolicy(request: SourcePolicyRequest): SourcePolicyDecision {
  if (!APPROVED_SOURCE_TYPES.has(request.sourceType)) {
    throw new BadRequestException(`Source type ${request.sourceType} is not allowed by policy`);
  }
  if (request.adapter.sourceType !== request.sourceType) {
    throw new BadRequestException("Configured source adapter does not match the requested source type");
  }
  const limit = Math.max(1, Math.min(100, Math.floor(request.requestedLimit || 25)));
  if (request.adapter.requiresApproval) {
    if (!request.approvalConfirmed || !request.approverUserId) {
      throw new ForbiddenException("This candidate source requires explicit human approval before execution");
    }
  }
  return {
    policyVersion: SOURCE_POLICY_VERSION,
    sourceType: request.sourceType,
    limit,
    requiresApproval: request.adapter.requiresApproval,
    ...(request.adapter.requiresApproval && request.approverUserId
      ? { approvedByUserId: request.approverUserId }
      : {}),
  };
}

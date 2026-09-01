import { Injectable, NotFoundException } from "@nestjs/common";
import {
  ApprovedSourceTypes,
  type ApprovedSourceType,
  type CandidateSourceAdapter,
} from "./candidate-source.adapter";
import { InternalTalentPoolAdapter } from "./internal-talent-pool.adapter";

@Injectable()
export class CandidateSourceRegistry {
  constructor(private readonly internalTalentPool: InternalTalentPoolAdapter) {}

  get(sourceType: ApprovedSourceType): CandidateSourceAdapter {
    if (sourceType === ApprovedSourceTypes.InternalTalentPool) return this.internalTalentPool;
    throw new NotFoundException(
      `Candidate source adapter ${sourceType} is not configured. Install an approved provider implementation before enabling this source.`,
    );
  }

  capabilities() {
    return Object.values(ApprovedSourceTypes).map((sourceType) => ({
      sourceType,
      configured: sourceType === this.internalTalentPool.sourceType,
      ...(sourceType === this.internalTalentPool.sourceType
        ? {
            providerKey: this.internalTalentPool.providerKey,
            requiresApproval: this.internalTalentPool.requiresApproval,
          }
        : { requiresApproval: true }),
    }));
  }
}

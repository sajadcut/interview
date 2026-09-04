import { Injectable, NotFoundException } from "@nestjs/common";
import {
  ApprovedSourceTypes,
  type CandidateSourceAdapter,
  type CandidateSourceSearchRequest,
  type CandidateSourceResult,
} from "./candidate-source.adapter";
import { GreenhouseAtsProvider } from "./greenhouse-ats.provider";
import { LeverAtsProvider } from "./lever-ats.provider";

@Injectable()
export class ConfiguredAtsSourceAdapter implements CandidateSourceAdapter {
  readonly sourceType = ApprovedSourceTypes.Ats;
  readonly providerKey = "configured-ats";
  readonly requiresApproval = true;

  constructor(
    private readonly greenhouse: GreenhouseAtsProvider,
    private readonly lever: LeverAtsProvider,
  ) {}

  async search(request: CandidateSourceSearchRequest): Promise<CandidateSourceResult[]> {
    const available = [];
    if (await this.greenhouse.isConfiguredFor(request.organizationId)) available.push(this.greenhouse);
    if (await this.lever.isConfiguredFor(request.organizationId)) available.push(this.lever);
    if (!available.length) {
      throw new NotFoundException(
        "No Greenhouse or Lever ATS connection is configured with resolvable credentials for this organization",
      );
    }

    const pages = await Promise.all(available.map((provider) => provider.search(request)));
    const merged = pages.flat();
    const seen = new Set<string>();
    const unique: CandidateSourceResult[] = [];
    for (const candidate of merged) {
      const key = `${candidate.provenance.providerKey}:${candidate.sourceExternalKey ?? candidate.provenance.externalKey ?? candidate.displayName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(candidate);
      if (unique.length >= request.limit) break;
    }
    return unique;
  }
}

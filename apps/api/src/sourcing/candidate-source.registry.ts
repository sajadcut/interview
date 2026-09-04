import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { TenantContextService } from "../tenant/tenant-context.service";
import {
  ApprovedSourceTypes,
  type ApprovedSourceType,
  type CandidateSourceAdapter,
} from "./candidate-source.adapter";
import type { AtsProvider, AtsProviderKey } from "./ats-provider.contracts";
import { ConfiguredAtsSourceAdapter } from "./configured-ats-source.adapter";
import type { ExternalSourceProviderKey } from "./external-source-connection.service";
import {
  CoresignalCandidateSourceProvider,
  PeopleDataLabsCandidateSourceProvider,
} from "./external-source.providers";
import { GreenhouseAtsProvider } from "./greenhouse-ats.provider";
import { InternalTalentPoolAdapter } from "./internal-talent-pool.adapter";
import { LeverAtsProvider } from "./lever-ats.provider";

type ExternalProvider = CandidateSourceAdapter & {
  providerKey: ExternalSourceProviderKey;
  isConfiguredFor(organizationId: string): Promise<boolean>;
};

@Injectable()
export class CandidateSourceRegistry {
  private readonly atsProviders: Map<AtsProviderKey, AtsProvider>;
  private readonly externalProviders: Map<ExternalSourceProviderKey, ExternalProvider>;

  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly internalTalentPool: InternalTalentPoolAdapter,
    private readonly configuredAts: ConfiguredAtsSourceAdapter,
    greenhouse: GreenhouseAtsProvider,
    lever: LeverAtsProvider,
    peopleDataLabs: PeopleDataLabsCandidateSourceProvider,
    coresignal: CoresignalCandidateSourceProvider,
  ) {
    this.atsProviders = new Map<AtsProviderKey, AtsProvider>([
      ["greenhouse", greenhouse],
      ["lever", lever],
    ]);
    this.externalProviders = new Map<ExternalSourceProviderKey, ExternalProvider>([
      ["people_data_labs", peopleDataLabs],
      ["coresignal", coresignal],
    ]);
  }

  get(sourceType: ApprovedSourceType, providerKey?: string): CandidateSourceAdapter {
    if (sourceType === ApprovedSourceTypes.InternalTalentPool) return this.internalTalentPool;
    if (sourceType === ApprovedSourceTypes.Ats) {
      if (!providerKey) return this.configuredAts;
      const normalized = providerKey.trim().toLowerCase();
      if (normalized !== "greenhouse" && normalized !== "lever") {
        throw new BadRequestException("providerKey must be greenhouse or lever when sourceType=ats");
      }
      const provider = this.atsProviders.get(normalized);
      if (provider) return provider;
    }
    if (sourceType === ApprovedSourceTypes.ApprovedExternal) {
      const normalized = providerKey?.trim().toLowerCase();
      if (!normalized) {
        throw new BadRequestException(
          "providerKey is required when sourceType=approved_external; supported providers are people_data_labs and coresignal",
        );
      }
      if (normalized !== "people_data_labs" && normalized !== "coresignal") {
        throw new BadRequestException(
          "providerKey must be people_data_labs or coresignal when sourceType=approved_external",
        );
      }
      const provider = this.externalProviders.get(normalized);
      if (provider) return provider;
    }
    throw new NotFoundException(
      `Candidate source adapter ${sourceType} is not configured. Install an approved provider implementation before enabling this source.`,
    );
  }

  async capabilities(organizationId?: string) {
    const tenantOrganizationId = organizationId ?? this.tenantContext.getOptional()?.organizationId;
    const ats = await Promise.all(
      [...this.atsProviders.values()].map(async (provider) => ({
        sourceType: ApprovedSourceTypes.Ats,
        configured: tenantOrganizationId ? await provider.isConfiguredFor(tenantOrganizationId) : false,
        providerKey: provider.providerKey,
        requiresApproval: provider.requiresApproval,
      })),
    );
    const external = await Promise.all(
      [...this.externalProviders.values()].map(async (provider) => ({
        sourceType: ApprovedSourceTypes.ApprovedExternal,
        configured: tenantOrganizationId ? await provider.isConfiguredFor(tenantOrganizationId) : false,
        providerKey: provider.providerKey,
        requiresApproval: provider.requiresApproval,
      })),
    );
    return [
      {
        sourceType: this.internalTalentPool.sourceType,
        configured: true,
        providerKey: this.internalTalentPool.providerKey,
        requiresApproval: this.internalTalentPool.requiresApproval,
      },
      ...ats,
      ...external,
      {
        sourceType: ApprovedSourceTypes.ApprovedJobBoard,
        configured: false,
        requiresApproval: true,
      },
    ];
  }
}

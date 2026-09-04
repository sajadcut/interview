import { Module } from "@nestjs/common";
import { AtsConnectionService } from "./ats-connection.service";
import { AtsIntegrationController } from "./ats-integration.controller";
import { AtsIntegrationService } from "./ats-integration.service";
import { CandidateSourceRegistry } from "./candidate-source.registry";
import { ConfiguredAtsSourceAdapter } from "./configured-ats-source.adapter";
import { ExternalSourceConnectionService } from "./external-source-connection.service";
import {
  CoresignalCandidateSourceProvider,
  PeopleDataLabsCandidateSourceProvider,
} from "./external-source.providers";
import { GreenhouseAtsProvider } from "./greenhouse-ats.provider";
import { InternalTalentPoolAdapter } from "./internal-talent-pool.adapter";
import { LeverAtsProvider } from "./lever-ats.provider";
import { SourcingController } from "./sourcing.controller";
import { SourcingImportExportController } from "./sourcing-import-export.controller";
import { SourcingImportExportService } from "./sourcing-import-export.service";
import { SourcingService } from "./sourcing.service";
import { TalentOperationsController } from "./talent-operations.controller";
import { TalentOperationsService } from "./talent-operations.service";

@Module({
  controllers: [
    SourcingController,
    AtsIntegrationController,
    SourcingImportExportController,
    TalentOperationsController,
  ],
  providers: [
    InternalTalentPoolAdapter,
    AtsConnectionService,
    GreenhouseAtsProvider,
    LeverAtsProvider,
    ConfiguredAtsSourceAdapter,
    ExternalSourceConnectionService,
    PeopleDataLabsCandidateSourceProvider,
    CoresignalCandidateSourceProvider,
    CandidateSourceRegistry,
    AtsIntegrationService,
    SourcingService,
    SourcingImportExportService,
    TalentOperationsService,
  ],
  exports: [
    SourcingService,
    AtsIntegrationService,
    SourcingImportExportService,
    TalentOperationsService,
    CandidateSourceRegistry,
  ],
})
export class SourcingModule {}

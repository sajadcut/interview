import { Module } from "@nestjs/common";
import { CandidateSourceRegistry } from "./candidate-source.registry";
import { InternalTalentPoolAdapter } from "./internal-talent-pool.adapter";
import { SourcingController } from "./sourcing.controller";
import { SourcingImportExportController } from "./sourcing-import-export.controller";
import { SourcingImportExportService } from "./sourcing-import-export.service";
import { SourcingService } from "./sourcing.service";
import { TalentOperationsController } from "./talent-operations.controller";
import { TalentOperationsService } from "./talent-operations.service";

@Module({
  controllers: [SourcingController, SourcingImportExportController, TalentOperationsController],
  providers: [
    InternalTalentPoolAdapter,
    CandidateSourceRegistry,
    SourcingService,
    SourcingImportExportService,
    TalentOperationsService,
  ],
  exports: [
    SourcingService,
    SourcingImportExportService,
    TalentOperationsService,
    CandidateSourceRegistry,
  ],
})
export class SourcingModule {}

import { Module } from "@nestjs/common";
import { CandidateSourceRegistry } from "./candidate-source.registry";
import { InternalTalentPoolAdapter } from "./internal-talent-pool.adapter";
import { SourcingController } from "./sourcing.controller";
import { SourcingService } from "./sourcing.service";
import { TalentOperationsController } from "./talent-operations.controller";
import { TalentOperationsService } from "./talent-operations.service";

@Module({
  controllers: [SourcingController, TalentOperationsController],
  providers: [
    InternalTalentPoolAdapter,
    CandidateSourceRegistry,
    SourcingService,
    TalentOperationsService,
  ],
  exports: [SourcingService, TalentOperationsService, CandidateSourceRegistry],
})
export class SourcingModule {}

import { Module } from "@nestjs/common";
import { InternalTalentPoolAdapter } from "./internal-talent-pool.adapter";
import { SourcingController } from "./sourcing.controller";
import { SourcingService } from "./sourcing.service";
import { TalentOperationsController } from "./talent-operations.controller";
import { TalentOperationsService } from "./talent-operations.service";

@Module({
  controllers: [SourcingController, TalentOperationsController],
  providers: [InternalTalentPoolAdapter, SourcingService, TalentOperationsService],
  exports: [SourcingService, TalentOperationsService],
})
export class SourcingModule {}

import { Module } from "@nestjs/common";
import { InternalTalentPoolAdapter } from "./internal-talent-pool.adapter";
import { SourcingController } from "./sourcing.controller";
import { SourcingService } from "./sourcing.service";

@Module({
  controllers: [SourcingController],
  providers: [InternalTalentPoolAdapter, SourcingService],
  exports: [SourcingService],
})
export class SourcingModule {}

import { Module } from "@nestjs/common";
import { CandidateIntelligenceController } from "./candidate-intelligence.controller";
import { CandidateIntelligenceService } from "./candidate-intelligence.service";
import { RecruitingOperationsController } from "./recruiting-operations.controller";
import { RecruitingOperationsService } from "./recruiting-operations.service";
import { RecruitingController } from "./recruiting.controller";
import { RecruitingService } from "./recruiting.service";

@Module({
  controllers: [RecruitingController, RecruitingOperationsController, CandidateIntelligenceController],
  providers: [RecruitingService, RecruitingOperationsService, CandidateIntelligenceService],
  exports: [RecruitingService, RecruitingOperationsService, CandidateIntelligenceService],
})
export class RecruitingModule {}

import { Module } from "@nestjs/common";
import { CandidateIntelligenceController } from "./candidate-intelligence.controller";
import { CandidateIntelligenceService } from "./candidate-intelligence.service";
import { RecruitingOperationsController } from "./recruiting-operations.controller";
import { RecruitingOperationsService } from "./recruiting-operations.service";
import { RecruitingController } from "./recruiting.controller";
import { RecruitingService } from "./recruiting.service";
import { ScorecardReviewController } from "./scorecard-review.controller";
import { ScorecardReviewService } from "./scorecard-review.service";

@Module({
  controllers: [
    RecruitingController,
    RecruitingOperationsController,
    CandidateIntelligenceController,
    ScorecardReviewController,
  ],
  providers: [
    RecruitingService,
    RecruitingOperationsService,
    CandidateIntelligenceService,
    ScorecardReviewService,
  ],
  exports: [
    RecruitingService,
    RecruitingOperationsService,
    CandidateIntelligenceService,
    ScorecardReviewService,
  ],
})
export class RecruitingModule {}

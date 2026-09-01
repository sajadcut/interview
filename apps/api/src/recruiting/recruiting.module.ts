import { Module } from "@nestjs/common";
import { RecruitingOperationsController } from "./recruiting-operations.controller";
import { RecruitingOperationsService } from "./recruiting-operations.service";
import { RecruitingController } from "./recruiting.controller";
import { RecruitingService } from "./recruiting.service";

@Module({
  controllers: [RecruitingController, RecruitingOperationsController],
  providers: [RecruitingService, RecruitingOperationsService],
  exports: [RecruitingService, RecruitingOperationsService],
})
export class RecruitingModule {}

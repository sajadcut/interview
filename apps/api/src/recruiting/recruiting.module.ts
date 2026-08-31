import { Module } from "@nestjs/common";
import { RecruitingController } from "./recruiting.controller";
import { RecruitingService } from "./recruiting.service";

@Module({
  controllers: [RecruitingController],
  providers: [RecruitingService],
  exports: [RecruitingService],
})
export class RecruitingModule {}

import { Module } from "@nestjs/common";
import { ResumeTextExtractor } from "../resumes/resume-text-extractor";
import { QuestionBankController } from "./question-bank.controller";
import { QuestionBankService } from "./question-bank.service";

@Module({
  controllers: [QuestionBankController],
  providers: [QuestionBankService, ResumeTextExtractor],
  exports: [QuestionBankService],
})
export class QuestionBankModule {}

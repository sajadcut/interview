import { Module } from "@nestjs/common";
import { ResumeTextExtractor } from "../resumes/resume-text-extractor";
import { QuestionBankController } from "./question-bank.controller";
import { QuestionBankService } from "./question-bank.service";
import { QuestionVersionsController } from "./question-versions.controller";
import { QuestionVersionsService } from "./question-versions.service";
import { AuthContextService } from "../auth/auth-context.service";

@Module({
  controllers: [QuestionBankController, QuestionVersionsController],
  providers: [QuestionBankService, ResumeTextExtractor, QuestionVersionsService],
  exports: [QuestionBankService],
})
export class QuestionBankModule {}

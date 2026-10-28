import { Module } from "@nestjs/common";
import { ResumeTextExtractor } from "../resumes/resume-text-extractor";
import { QuestionBankController } from "./question-bank.controller";
import { QuestionBankService } from "./question-bank.service";
import { QuestionVersionsController } from "./question-versions.controller";
import { QuestionVersionsService } from "./question-versions.service";
import { QuestionProposalProvider } from "./question-proposal-provider";
import { QuestionProposalsController } from "./question-proposals.controller";
import { QuestionProposalsService } from "./question-proposals.service";

@Module({
  controllers: [QuestionBankController, QuestionVersionsController, QuestionProposalsController],
  providers: [QuestionBankService, ResumeTextExtractor, QuestionVersionsService, QuestionProposalProvider, QuestionProposalsService],
  exports: [QuestionBankService],
})
export class QuestionBankModule {}

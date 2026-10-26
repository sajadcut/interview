import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { AuditedAction } from "../audit/audited-action.decorator";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import { BankQuestionDto, BankQuestionReviewDto, CreateBankQuestionDto, ReviseBankQuestionDto, ReviewBankQuestionDto } from "./question-versions.dto";
import { QuestionVersionsService } from "./question-versions.service";

@ApiTags("question-bank")
@Controller("v1/question-bank/jobs/:jobId/questions")
@RequireTenant()
export class QuestionVersionsController {
  constructor(private readonly questions: QuestionVersionsService) {}

  @Get()
  @RequirePermissions(Permissions.JobRead)
  @ApiOkResponse({ type: BankQuestionDto, isArray: true })
  list(@Param("jobId", ParseUUIDPipe) jobId: string) { return this.questions.list(jobId); }

  @Post()
  @RequirePermissions(Permissions.JobEdit)
  @AuditedAction("question_bank.question.create", "job")
  @ApiOkResponse({ type: BankQuestionDto, isArray: true })
  create(@Param("jobId", ParseUUIDPipe) jobId: string, @Body() input: CreateBankQuestionDto) {
    return this.questions.create(jobId,input);
  }

  @Put(":questionId")
  @RequirePermissions(Permissions.JobEdit)
  @AuditedAction("question_bank.question.revise", "job")
  @ApiOkResponse({ type: BankQuestionDto, isArray: true })
  revise(@Param("jobId", ParseUUIDPipe) jobId: string,
    @Param("questionId", ParseUUIDPipe) questionId: string, @Body() input: ReviseBankQuestionDto) {
    return this.questions.revise(jobId,questionId,input);
  }

  @Put(":questionId/review")
  @RequirePermissions(Permissions.JobEdit)
  @AuditedAction("question_bank.question.review", "job")
  @ApiOkResponse({ type: BankQuestionReviewDto })
  review(@Param("jobId", ParseUUIDPipe) jobId: string,
    @Param("questionId", ParseUUIDPipe) questionId: string, @Body() input: ReviewBankQuestionDto) {
    return this.questions.review(jobId,questionId,input);
  }
}

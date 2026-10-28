import { Body, Controller, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { AuditedAction } from "../audit/audited-action.decorator";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import { GenerateBankQuestionProposalsDto, GenerateBankQuestionProposalsResponseDto } from "./question-proposals.dto";
import { QuestionProposalsService } from "./question-proposals.service";

@ApiTags("question-bank")
@Controller("v1/question-bank/jobs/:jobId/questions")
@RequireTenant()
export class QuestionProposalsController {
  constructor(private readonly proposals: QuestionProposalsService) {}

  @Post("propose")
  @RequirePermissions(Permissions.JobEdit)
  @AuditedAction("question_bank.questions.llm_propose_opt_in", "job")
  @ApiOkResponse({ type: GenerateBankQuestionProposalsResponseDto })
  generate(@Param("jobId", ParseUUIDPipe) jobId: string,
           @Body() input: GenerateBankQuestionProposalsDto) {
    return this.proposals.generate(jobId, input);
  }
}

import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import {
  AssignInterviewerDto,
  InterviewerNoteInputDto,
  SubmitInterviewerEvaluationDto,
} from "./interviewer.dto";
import { InterviewerService } from "./interviewer.service";

@ApiTags("interviewer")
@Controller("v1/interviewer")
@RequireTenant()
export class InterviewerController {
  constructor(private readonly interviewer: InterviewerService) {}

  @Post("assignments")
  @RequirePermissions(Permissions.InterviewAssign)
  assign(@Body() body: AssignInterviewerDto) {
    return this.interviewer.assign(body);
  }

  @Get("interviews")
  @RequirePermissions(Permissions.InterviewRead)
  listMine() {
    return this.interviewer.listMine();
  }

  @Get("interviews/:sessionId")
  @RequirePermissions(Permissions.InterviewRead)
  getMine(@Param("sessionId") sessionId: string) {
    return this.interviewer.getMine(sessionId);
  }

  @Post("interviews/:sessionId/start")
  @RequirePermissions(Permissions.InterviewStart)
  start(@Param("sessionId") sessionId: string) {
    return this.interviewer.start(sessionId);
  }

  @Post("interviews/:sessionId/complete")
  @RequirePermissions(Permissions.InterviewStart)
  complete(@Param("sessionId") sessionId: string) {
    return this.interviewer.complete(sessionId);
  }

  @Get("interviews/:sessionId/notes")
  @RequirePermissions(Permissions.InterviewRead)
  listNotes(@Param("sessionId") sessionId: string) {
    return this.interviewer.listNotes(sessionId);
  }

  @Post("interviews/:sessionId/notes")
  @RequirePermissions(Permissions.InterviewEvaluate)
  addNote(@Param("sessionId") sessionId: string, @Body() body: InterviewerNoteInputDto) {
    return this.interviewer.addNote(sessionId, body);
  }

  @Post("interviews/:sessionId/evaluation")
  @RequirePermissions(Permissions.InterviewEvaluate)
  submitEvaluation(
    @Param("sessionId") sessionId: string,
    @Body() body: SubmitInterviewerEvaluationDto,
  ) {
    return this.interviewer.submitEvaluation(sessionId, body);
  }
}

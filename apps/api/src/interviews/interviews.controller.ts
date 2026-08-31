import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { AuditedAction } from "../audit/audited-action.decorator";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import {
  AppendInterviewTurnDto,
  CreateInterviewSessionDto,
  InterviewEvidenceDto,
  InterviewEvidenceInputDto,
  InterviewSessionStartDto,
  InterviewTurnDto,
  TranscriptSegmentDto,
  TranscriptSegmentInputDto,
} from "./interviews.dto";
import { InterviewsService } from "./interviews.service";

@ApiTags("interviews")
@Controller("v1")
@RequireTenant()
export class InterviewsController {
  constructor(private readonly interviews: InterviewsService) {}

  @Post("interviews/sessions")
  @RequirePermissions(Permissions.InterviewManage)
  @AuditedAction("interview.session.create", "interview_session")
  @ApiOkResponse({ type: InterviewSessionStartDto })
  createSession(@Body() body: CreateInterviewSessionDto) {
    return this.interviews.createSession(body);
  }

  @Post("interviews/:sessionId/turns")
  @RequirePermissions(Permissions.InterviewManage)
  @AuditedAction("interview.turn.append", "interview_session")
  @ApiOkResponse({ type: InterviewTurnDto })
  appendTurn(@Param("sessionId") sessionId: string, @Body() body: AppendInterviewTurnDto) {
    return this.interviews.appendTurn(sessionId, body);
  }

  @Post("interviews/:sessionId/transcript-segments")
  @RequirePermissions(Permissions.InterviewManage)
  @AuditedAction("interview.transcript.append", "interview_session")
  @ApiOkResponse({ type: TranscriptSegmentDto })
  appendTranscriptSegment(
    @Param("sessionId") sessionId: string,
    @Body() body: TranscriptSegmentInputDto,
  ) {
    return this.interviews.appendTranscriptSegment(sessionId, body);
  }

  @Post("interviews/:sessionId/evidence")
  @RequirePermissions(Permissions.InterviewEvaluate)
  @AuditedAction("interview.evidence.record", "interview_session")
  @ApiOkResponse({ type: InterviewEvidenceDto })
  recordEvidence(@Param("sessionId") sessionId: string, @Body() body: InterviewEvidenceInputDto) {
    return this.interviews.recordEvidence(sessionId, body);
  }

  @Get("interviews/:sessionId/review")
  @RequirePermissions(Permissions.InterviewRead)
  getReview(@Param("sessionId") sessionId: string) {
    return this.interviews.getReview(sessionId);
  }

  @Post("interview-release-units/:releaseUnitId/preflight")
  @RequirePermissions(Permissions.InterviewManage)
  @AuditedAction("interview.release.preflight", "interview_release_unit")
  preflightRelease(@Param("releaseUnitId") releaseUnitId: string, @Body() body: unknown) {
    return this.interviews.preflightRelease(releaseUnitId, body);
  }
}

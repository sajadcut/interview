import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { AuditedAction } from "../audit/audited-action.decorator";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { ApiStandardErrorResponses } from "../common/http/api-standard-error-responses.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import { ReviewSkillProposalDto, ReviewedSkillProposalDto, SkillProposalDto, SkillProposalResponseDto } from "./skill-proposals.dto";
import { SkillProposalsService } from "./skill-proposals.service";

@ApiTags("skill-proposals")
@ApiStandardErrorResponses()
@Controller("v1/candidates/:candidateId/resumes/:resumeId/skill-proposals")
@RequireTenant()
export class SkillProposalsController {
  constructor(private readonly proposals: SkillProposalsService) {}

  @Get()
  @RequirePermissions(Permissions.CandidateRead)
  @ApiOkResponse({ type: SkillProposalDto, isArray: true })
  list(@Param("candidateId", ParseUUIDPipe) candidateId: string,
       @Param("resumeId", ParseUUIDPipe) resumeId: string) {
    return this.proposals.list(candidateId, resumeId);
  }

  @Post("generate")
  @RequirePermissions(Permissions.CandidateResumeManage)
  @AuditedAction("resume.skill_proposals.generate_opt_in", "candidate")
  @ApiOkResponse({ type: SkillProposalResponseDto })
  generate(@Param("candidateId", ParseUUIDPipe) candidateId: string,
           @Param("resumeId", ParseUUIDPipe) resumeId: string) {
    return this.proposals.generate(candidateId, resumeId);
  }

  @Put(":proposalId/review")
  @RequirePermissions(Permissions.CandidateResumeManage)
  @AuditedAction("resume.skill_proposals.human_review", "candidate")
  @ApiOkResponse({ type: ReviewedSkillProposalDto })
  review(@Param("candidateId", ParseUUIDPipe) candidateId: string,
         @Param("resumeId", ParseUUIDPipe) resumeId: string,
         @Param("proposalId", ParseUUIDPipe) proposalId: string,
         @Body() input: ReviewSkillProposalDto) {
    return this.proposals.review(candidateId, resumeId, proposalId, input);
  }
}

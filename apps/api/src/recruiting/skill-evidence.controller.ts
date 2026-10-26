import { Body, Controller, Get, Param, Put, ParseUUIDPipe } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { AuditedAction } from "../audit/audited-action.decorator";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { ApiStandardErrorResponses } from "../common/http/api-standard-error-responses.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import {
  JobSkillRequirementDto, ReviewedResumeSkillClaimDto,
  ReviewResumeSkillClaimDto, SaveJobSkillRequirementsDto,
} from "./skill-evidence.dto";
import { SkillEvidenceService } from "./skill-evidence.service";

@ApiTags("skill-evidence")
@ApiStandardErrorResponses()
@Controller("v1")
@RequireTenant()
export class SkillEvidenceController {
  constructor(private readonly skills: SkillEvidenceService) {}

  @Get("jobs/:jobId/skill-requirements")
  @RequirePermissions(Permissions.JobRead)
  @ApiOkResponse({ type: JobSkillRequirementDto, isArray: true })
  listJobSkills(@Param("jobId", ParseUUIDPipe) jobId: string) {
    return this.skills.listJobSkills(jobId);
  }

  @Put("jobs/:jobId/skill-requirements")
  @RequirePermissions(Permissions.JobEdit)
  @AuditedAction("job.skill_requirements.replace", "job")
  @ApiOkResponse({ type: JobSkillRequirementDto, isArray: true })
  replaceJobSkills(@Param("jobId", ParseUUIDPipe) jobId: string, @Body() input: SaveJobSkillRequirementsDto) {
    return this.skills.replaceJobSkills(jobId, input.skills);
  }

  @Put("candidates/:candidateId/skill-claims/:claimId/review")
  @RequirePermissions(Permissions.CandidateResumeManage)
  @AuditedAction("candidate.resume_skill_claim.review", "candidate")
  @ApiOkResponse({ type: ReviewedResumeSkillClaimDto })
  reviewClaim(
    @Param("candidateId", ParseUUIDPipe) candidateId: string,
    @Param("claimId", ParseUUIDPipe) claimId: string,
    @Body() input: ReviewResumeSkillClaimDto,
  ) {
    return this.skills.reviewResumeClaim(candidateId, claimId, input);
  }
}

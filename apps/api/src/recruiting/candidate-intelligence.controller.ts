import { Controller, Get, Param } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import { CandidateIntelligenceService } from "./candidate-intelligence.service";

@ApiTags("candidate-intelligence")
@Controller("v1/candidates")
@RequireTenant()
@RequirePermissions(Permissions.CandidateRead)
export class CandidateIntelligenceController {
  constructor(private readonly intelligence: CandidateIntelligenceService) {}

  @Get(":candidateId/intelligence-workspace")
  getWorkspace(@Param("candidateId") candidateId: string) {
    return this.intelligence.getWorkspace(candidateId);
  }
}

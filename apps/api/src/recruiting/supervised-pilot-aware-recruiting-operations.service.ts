import { Injectable } from "@nestjs/common";
import { AuthContextService } from "../auth/auth-context.service";
import { DatabaseService } from "../database/database.service";
import { SupervisedPilotService } from "../interviews/supervised-pilot.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import type { MoveApplicationStageDto, SubmitHiringDecisionDto } from "./recruiting-operations.dto";
import { RecruitingOperationsService } from "./recruiting-operations.service";

@Injectable()
export class SupervisedPilotAwareRecruitingOperationsService extends RecruitingOperationsService {
  constructor(
    database: DatabaseService,
    tenantContext: TenantContextService,
    authContext: AuthContextService,
    private readonly pilot: SupervisedPilotService,
  ) {
    super(database, tenantContext, authContext);
  }

  override async moveApplicationStage(applicationId: string, input: MoveApplicationStageDto) {
    await this.pilot.assertHumanReviewCompleteForApplication(applicationId);
    return super.moveApplicationStage(applicationId, input);
  }

  override async submitHiringDecision(applicationId: string, input: SubmitHiringDecisionDto) {
    if (input.decision !== "withdraw") {
      await this.pilot.assertHumanReviewCompleteForApplication(applicationId);
    }
    return super.submitHiringDecision(applicationId, input);
  }
}

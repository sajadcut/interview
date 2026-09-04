import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import { evaluateInterviewRelease, type InterviewLifecycleStage } from "./interview-release.policy";
import { InterviewsService } from "./interviews.service";
import { SupervisedPilotService } from "./supervised-pilot.service";

@Injectable()
export class SupervisedPilotAwareInterviewsService extends InterviewsService {
  constructor(
    private readonly pilotDatabase: DatabaseService,
    private readonly pilotTenantContext: TenantContextService,
    private readonly pilot: SupervisedPilotService,
  ) {
    super(pilotDatabase, pilotTenantContext);
  }

  override async createSession(body: unknown) {
    if (!body || typeof body !== "object") throw new Error("Interview session input is required");
    const value = body as Record<string, unknown>;
    for (const key of ["applicationId", "interviewPlanId", "consentRecordId"] as const) {
      if (typeof value[key] !== "string" || !value[key].trim()) throw new Error(`${key} is required`);
    }

    const organizationId = this.pilotTenantContext.require().organizationId;
    const applicationId = String(value.applicationId);
    const interviewPlanId = String(value.interviewPlanId);
    const consentRecordId = String(value.consentRecordId);
    const planRows = await this.pilotDatabase.sql`
      SELECT p.id, p.version, p.time_budget_minutes,
             r.id::text AS release_unit_id, r.lifecycle_stage,
             r.production_approved_at, r.production_approved_by_user_id
      FROM interview_plans p
      JOIN interview_release_units r
        ON r.organization_id = p.organization_id AND r.id = p.release_unit_id
      JOIN applications a
        ON a.organization_id = p.organization_id
       AND a.id = ${applicationId}::uuid
       AND a.job_id = p.job_id
      WHERE p.organization_id = ${organizationId}::uuid
        AND p.id = ${interviewPlanId}::uuid
        AND p.status = 'published'
      LIMIT 1
    `;
    if (!planRows[0]) throw new Error("Published interview plan not found for application");
    const plan = planRows[0];
    const lifecycleStage = String(plan.lifecycle_stage) as InterviewLifecycleStage;
    const realCandidate = value.candidateIsRealCustomerCandidate === true;

    if (lifecycleStage !== "SUPERVISED_PILOT" || !realCandidate) {
      const session = await super.createSession(body);
      return {
        ...session,
        humanReviewRequired: false,
        aiFinalDecisionProhibited: false,
      };
    }

    const consentRows = await this.pilotDatabase.sql`
      SELECT id, transcript_allowed
      FROM consent_records
      WHERE organization_id = ${organizationId}::uuid
        AND id = ${consentRecordId}::uuid
        AND application_id = ${applicationId}::uuid
        AND purpose = 'ai_interview'
        AND withdrawn_at IS NULL
      LIMIT 1
    `;
    if (!consentRows[0]) throw new Error("Active AI interview consent is required");
    if (consentRows[0].transcript_allowed !== true) {
      throw new Error("Transcript consent is required for evidence-backed interviewing");
    }

    const release = evaluateInterviewRelease({
      lifecycleStage,
      productionApprovedAt: plan.production_approved_at ? String(plan.production_approved_at) : null,
      productionApprovedByUserId: plan.production_approved_by_user_id
        ? String(plan.production_approved_by_user_id)
        : null,
      candidateIsRealCustomerCandidate: true,
      synchronousHumanSupervisorPresent: value.synchronousHumanSupervisorPresent === true,
    });
    if (!release.allowed) throw new Error(`Interview release blocked: ${release.reasons.join("; ")}`);

    const remainingSeconds = Number(plan.time_budget_minutes) * 60;
    const admitted = await this.pilot.createAdmittedSession({
      releaseUnitId: String(plan.release_unit_id),
      applicationId,
      interviewPlanId,
      remainingSeconds,
      checkpoint: {
        consentRecordId,
        releaseMode: release.mode,
        releaseReasons: release.reasons,
        candidateIsRealCustomerCandidate: true,
      },
    });

    return {
      ...admitted,
      lifecycleStage,
      releaseMode: release.mode,
      planVersion: Number(plan.version),
      remainingSeconds,
    };
  }
}

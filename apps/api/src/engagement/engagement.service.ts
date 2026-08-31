import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import {
  evaluateCandidateReplyPolicy,
  evaluateHardMinimums,
  type CandidateReplyDraft,
  type HardMinimumRule,
} from "./candidate-communication.policy";

@Injectable()
export class EngagementService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
  ) {}

  previewCandidateReply(body: unknown) {
    if (!body || typeof body !== "object") throw new Error("Reply policy input is required");
    const value = body as Record<string, unknown>;
    if (typeof value.body !== "string") throw new Error("Reply body is required");
    if (!Array.isArray(value.groundingReferences) || !value.groundingReferences.every((item) => typeof item === "string")) {
      throw new Error("groundingReferences must be a string array");
    }

    const draft: CandidateReplyDraft = {
      body: value.body,
      groundingReferences: value.groundingReferences,
      autoSendRequested: value.autoSendRequested === true,
      autoSendPolicyEnabled: value.autoSendPolicyEnabled === true,
    };
    return evaluateCandidateReplyPolicy(draft);
  }

  previewScreening(body: unknown) {
    if (!body || typeof body !== "object") throw new Error("Screening input is required");
    const value = body as Record<string, unknown>;
    if (!Array.isArray(value.rules)) throw new Error("rules must be an array");
    if (!value.answers || typeof value.answers !== "object" || Array.isArray(value.answers)) {
      throw new Error("answers must be an object");
    }

    const rules: HardMinimumRule[] = value.rules.map((raw, index) => {
      if (!raw || typeof raw !== "object") throw new Error(`rule ${index} must be an object`);
      const rule = raw as Record<string, unknown>;
      if (typeof rule.key !== "string") throw new Error(`rule ${index} requires key`);
      if (typeof rule.required !== "boolean") throw new Error(`rule ${index} requires required`);
      if (!["string", "number", "boolean"].includes(typeof rule.expected)) {
        throw new Error(`rule ${index} has unsupported expected value`);
      }
      return {
        key: rule.key,
        required: rule.required,
        expected: rule.expected as string | number | boolean,
      };
    });

    return evaluateHardMinimums(
      rules,
      value.answers as Record<string, string | number | boolean | null | undefined>,
    );
  }

  async createSchedulingRequest(applicationId: string, body: unknown) {
    if (!body || typeof body !== "object") throw new Error("Scheduling input is required");
    const value = body as Record<string, unknown>;
    if (typeof value.interviewType !== "string" || !value.interviewType.trim()) {
      throw new Error("interviewType is required");
    }
    if (typeof value.timezone !== "string" || !value.timezone.trim()) throw new Error("timezone is required");
    if (!Array.isArray(value.proposedSlots)) throw new Error("proposedSlots must be an array");

    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      INSERT INTO scheduling_requests (
        organization_id, application_id, interview_type, timezone, proposed_slots, reminder_policy
      ) VALUES (
        ${organizationId}::uuid,
        ${applicationId}::uuid,
        ${value.interviewType.trim()},
        ${value.timezone.trim()},
        ${this.database.sql.json(value.proposedSlots as never)},
        ${this.database.sql.json({ candidateReminderHours: [24, 2] } as never)}
      )
      RETURNING id, status, interview_type, timezone, proposed_slots, created_at
    `;
    return rows[0];
  }
}

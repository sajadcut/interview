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

  private parseReplyDraft(body: unknown): CandidateReplyDraft {
    if (!body || typeof body !== "object") throw new Error("Reply policy input is required");
    const value = body as Record<string, unknown>;
    if (typeof value.body !== "string") throw new Error("Reply body is required");
    if (!Array.isArray(value.groundingReferences) || !value.groundingReferences.every((item) => typeof item === "string")) {
      throw new Error("groundingReferences must be a string array");
    }
    return {
      body: value.body,
      groundingReferences: value.groundingReferences,
      autoSendRequested: value.autoSendRequested === true,
      autoSendPolicyEnabled: value.autoSendPolicyEnabled === true,
    };
  }

  private parseScreening(body: unknown): {
    rulesVersion: string;
    rules: HardMinimumRule[];
    answers: Record<string, string | number | boolean | null | undefined>;
  } {
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

    return {
      rulesVersion:
        typeof value.rulesVersion === "string" && value.rulesVersion.trim()
          ? value.rulesVersion.trim()
          : "unversioned-development-screen",
      rules,
      answers: value.answers as Record<string, string | number | boolean | null | undefined>,
    };
  }

  previewCandidateReply(body: unknown) {
    return evaluateCandidateReplyPolicy(this.parseReplyDraft(body));
  }

  async createOutboundMessage(conversationId: string, body: unknown) {
    const organizationId = this.tenantContext.require().organizationId;
    const draft = this.parseReplyDraft(body);

    const conversation = await this.database.sql`
      SELECT id
      FROM conversations
      WHERE organization_id = ${organizationId}::uuid AND id = ${conversationId}::uuid
      LIMIT 1
    `;
    if (!conversation.length) throw new Error("Conversation not found");

    for (const reference of draft.groundingReferences) {
      const approved = await this.database.sql`
        SELECT id
        FROM knowledge_items
        WHERE organization_id = ${organizationId}::uuid
          AND id = ${reference}::uuid
          AND status = 'approved'
          AND (valid_from IS NULL OR valid_from <= now())
          AND (valid_until IS NULL OR valid_until > now())
        LIMIT 1
      `;
      if (!approved.length) {
        return {
          allowed: false,
          approvalState: "blocked" as const,
          reasons: [`Knowledge reference ${reference} is not currently approved`],
          message: null,
        };
      }
    }

    const policy = evaluateCandidateReplyPolicy(draft);
    if (!policy.allowed) return { ...policy, message: null };

    const rows = await this.database.sql`
      INSERT INTO messages (
        organization_id,
        conversation_id,
        direction,
        sender_type,
        body,
        grounding_references,
        approval_state,
        sent_at
      ) VALUES (
        ${organizationId}::uuid,
        ${conversationId}::uuid,
        'outbound',
        'ai',
        ${draft.body.trim()},
        ${this.database.sql.json(draft.groundingReferences as never)},
        ${policy.approvalState},
        ${policy.approvalState === "approved_for_auto_send" ? new Date() : null}
      )
      RETURNING id, direction, sender_type, body, grounding_references, approval_state, sent_at, created_at
    `;

    return { ...policy, message: rows[0] ?? null };
  }

  async getConversation(conversationId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const conversations = await this.database.sql`
      SELECT id, candidate_id, application_id, channel, status
      FROM conversations
      WHERE organization_id = ${organizationId}::uuid AND id = ${conversationId}::uuid
      LIMIT 1
    `;
    if (!conversations.length) return null;
    const messages = await this.database.sql`
      SELECT id, direction, sender_type, body, grounding_references, approval_state, sent_at, created_at
      FROM messages
      WHERE organization_id = ${organizationId}::uuid AND conversation_id = ${conversationId}::uuid
      ORDER BY created_at
    `;
    const conversation = conversations[0];
    return {
      id: String(conversation?.id),
      candidateId: String(conversation?.candidate_id),
      ...(conversation?.application_id ? { applicationId: String(conversation.application_id) } : {}),
      channel: String(conversation?.channel),
      status: String(conversation?.status),
      messages: messages.map((row) => ({
        id: String(row.id),
        direction: String(row.direction),
        senderType: String(row.sender_type),
        body: String(row.body),
        groundingReferences: Array.isArray(row.grounding_references)
          ? row.grounding_references.map(String)
          : [],
        approvalState: String(row.approval_state),
        ...(row.sent_at ? { sentAt: new Date(String(row.sent_at)).toISOString() } : {}),
        createdAt: new Date(String(row.created_at)).toISOString(),
      })),
    };
  }

  previewScreening(body: unknown) {
    const parsed = this.parseScreening(body);
    return evaluateHardMinimums(parsed.rules, parsed.answers);
  }

  async createScreeningSession(applicationId: string, body: unknown) {
    const organizationId = this.tenantContext.require().organizationId;
    const parsed = this.parseScreening(body);
    const result = evaluateHardMinimums(parsed.rules, parsed.answers);
    const recommendation = result.eligible ? "advance" : "review_ineligible";

    const rows = await this.database.sql`
      INSERT INTO screening_sessions (
        organization_id,
        application_id,
        status,
        rules_version,
        answers,
        hard_filter_result,
        recommendation,
        review_state
      ) VALUES (
        ${organizationId}::uuid,
        ${applicationId}::uuid,
        'completed',
        ${parsed.rulesVersion},
        ${this.database.sql.json(parsed.answers as never)},
        ${this.database.sql.json({
          eligible: result.eligible,
          failedRequiredRules: result.failedRequiredRules,
          reviewRequired: true,
        } as never)},
        ${recommendation},
        'pending_human_review'
      )
      RETURNING id, status, rules_version, hard_filter_result, recommendation, review_state, created_at
    `;
    const row = rows[0];
    return {
      id: String(row?.id),
      status: String(row?.status),
      rulesVersion: String(row?.rules_version),
      eligible: result.eligible,
      failedRequiredRules: result.failedRequiredRules,
      recommendation,
      reviewState: String(row?.review_state),
      createdAt: new Date(String(row?.created_at)).toISOString(),
    };
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
      RETURNING id, application_id, status, interview_type, timezone, proposed_slots,
                selected_start, selected_end, calendar_provider, calendar_reference, reminder_policy, created_at
    `;
    return this.mapSchedulingRow(rows[0]);
  }

  async listSchedulingRequests(applicationId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      SELECT id, application_id, status, interview_type, timezone, proposed_slots,
             selected_start, selected_end, calendar_provider, calendar_reference, reminder_policy, created_at
      FROM scheduling_requests
      WHERE organization_id = ${organizationId}::uuid AND application_id = ${applicationId}::uuid
      ORDER BY created_at DESC
    `;
    return rows.map((row) => this.mapSchedulingRow(row));
  }

  async confirmSchedulingRequest(requestId: string, body: unknown) {
    if (!body || typeof body !== "object") throw new Error("Scheduling confirmation is required");
    const value = body as Record<string, unknown>;
    const selectedStart = typeof value.selectedStart === "string" ? new Date(value.selectedStart) : null;
    const selectedEnd = typeof value.selectedEnd === "string" ? new Date(value.selectedEnd) : null;
    if (!selectedStart || Number.isNaN(selectedStart.valueOf())) throw new Error("selectedStart must be an ISO date");
    if (!selectedEnd || Number.isNaN(selectedEnd.valueOf())) throw new Error("selectedEnd must be an ISO date");
    if (selectedEnd <= selectedStart) throw new Error("selectedEnd must be after selectedStart");

    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      UPDATE scheduling_requests
      SET status = 'confirmed', selected_start = ${selectedStart}, selected_end = ${selectedEnd}, updated_at = now()
      WHERE organization_id = ${organizationId}::uuid AND id = ${requestId}::uuid
      RETURNING id, application_id, status, interview_type, timezone, proposed_slots,
                selected_start, selected_end, calendar_provider, calendar_reference, reminder_policy, created_at
    `;
    if (!rows.length) throw new Error("Scheduling request not found");
    return this.mapSchedulingRow(rows[0]);
  }

  private mapSchedulingRow(row: Record<string, unknown> | undefined) {
    if (!row) throw new Error("Scheduling persistence returned no row");
    return {
      id: String(row.id),
      applicationId: String(row.application_id),
      interviewType: String(row.interview_type),
      status: String(row.status),
      timezone: String(row.timezone),
      proposedSlots: Array.isArray(row.proposed_slots) ? row.proposed_slots : [],
      ...(row.selected_start ? { selectedStart: new Date(String(row.selected_start)).toISOString() } : {}),
      ...(row.selected_end ? { selectedEnd: new Date(String(row.selected_end)).toISOString() } : {}),
      ...(row.calendar_provider ? { calendarProvider: String(row.calendar_provider) } : {}),
      ...(row.calendar_reference ? { calendarReference: String(row.calendar_reference) } : {}),
      reminderPolicy:
        row.reminder_policy && typeof row.reminder_policy === "object"
          ? (row.reminder_policy as Record<string, unknown>)
          : {},
      createdAt: new Date(String(row.created_at)).toISOString(),
    };
  }
}

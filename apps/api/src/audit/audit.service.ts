import { createHash } from "node:crypto";
import { BadRequestException, Injectable } from "@nestjs/common";
import { AuthContextService } from "../auth/auth-context.service";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import type { AuditExportQueryDto } from "./audit-export.dto";
import type { AuditRecordInput } from "./audit.types";

const SENSITIVE_AUDIT_KEY =
  /(?:password|passphrase|secret|token|authorization|cookie|credential|api[_-]?key|private[_-]?key)/i;
const AUDIT_EXPORT_VERSION = "2.0";
const REDACTED = "[REDACTED]";

function sanitizeAuditValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => sanitizeAuditValue(entry));
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      SENSITIVE_AUDIT_KEY.test(key) ? REDACTED : sanitizeAuditValue(entry),
    ]),
  );
}

function nullableSanitizedRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return sanitizeAuditValue(value) as Record<string, unknown>;
}

function sourceCounts(rows: Array<Record<string, unknown>>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const source = String(row.source_ledger ?? "unknown");
    counts[source] = (counts[source] ?? 0) + 1;
  }
  return counts;
}

@Injectable()
export class AuditService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
    private readonly authContext: AuthContextService,
  ) {}

  async record(input: AuditRecordInput): Promise<void> {
    const organizationId = this.tenantContext.require().organizationId;
    const principal = this.authContext.getOptional();
    const actorType = input.actorType ?? (principal ? "user" : "system");

    await this.database.sql`
      INSERT INTO audit_events (
        organization_id, actor_type, actor_user_id, action, entity_type, entity_id,
        reason, before, after, metadata
      ) VALUES (
        ${organizationId}::uuid,
        ${actorType},
        ${principal?.userId ?? null}::uuid,
        ${input.action},
        ${input.entityType},
        ${input.entityId ?? null},
        ${input.reason ?? null},
        ${input.before ? this.database.sql.json(input.before as never) : null},
        ${input.after ? this.database.sql.json(input.after as never) : null},
        ${input.metadata ? this.database.sql.json(input.metadata as never) : null}
      )
    `;
  }

  async exportEvents(query: AuditExportQueryDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const from = query.from ?? null;
    const to = query.to ?? null;
    if (from && to && Date.parse(from) > Date.parse(to)) {
      throw new BadRequestException("Audit export 'from' must be before or equal to 'to'");
    }

    // Omitted limit means a complete organization export. An explicit limit remains
    // available for previews/backward compatibility and reports truncation accurately.
    const requestedLimit = query.limit ?? null;
    const rowLimit = requestedLimit === null ? 2_147_483_647 : requestedLimit + 1;

    const rows = (await this.database.sql`
      WITH unified AS (
        SELECT
          'audit_events'::text AS source_ledger,
          event.id::text AS id,
          event.actor_type::text AS actor_type,
          event.actor_user_id::text AS actor_user_id,
          event.action::text AS action,
          event.entity_type::text AS entity_type,
          event.entity_id::text AS entity_id,
          event.reason::text AS reason,
          event.before AS before,
          event.after AS after,
          event.metadata AS metadata,
          event.created_at AS created_at
        FROM audit_events event
        WHERE event.organization_id = ${organizationId}::uuid

        UNION ALL

        SELECT
          'recruitment_events',
          event.id::text,
          'system',
          NULL,
          ('recruitment.' || event.event_type)::text,
          CASE
            WHEN event.application_id IS NOT NULL THEN 'application'
            WHEN event.candidate_id IS NOT NULL THEN 'candidate'
            WHEN event.job_id IS NOT NULL THEN 'job'
            ELSE 'recruitment_event'
          END,
          COALESCE(event.application_id::text, event.candidate_id::text, event.job_id::text, event.id::text),
          NULL,
          NULL,
          jsonb_build_object('stage', event.stage),
          COALESCE(event.metadata, '{}'::jsonb) || jsonb_build_object(
            'source', event.source,
            'recruitmentEventId', event.id::text
          ),
          event.occurred_at
        FROM recruitment_events event
        WHERE event.organization_id = ${organizationId}::uuid

        UNION ALL

        SELECT
          'application_stage_transitions',
          transition.id::text,
          CASE WHEN transition.actor_user_id IS NULL THEN 'system' ELSE 'user' END,
          transition.actor_user_id::text,
          'application.stage_changed',
          'application',
          transition.application_id::text,
          transition.reason,
          jsonb_build_object('pipelineStage', transition.from_stage),
          jsonb_build_object('pipelineStage', transition.to_stage),
          jsonb_build_object('transitionId', transition.id::text),
          transition.created_at
        FROM application_stage_transitions transition
        WHERE transition.organization_id = ${organizationId}::uuid

        UNION ALL

        SELECT
          'hiring_decisions',
          decision.id::text,
          'user',
          decision.actor_user_id::text,
          'hiring.decision_recorded',
          'application',
          decision.application_id::text,
          decision.reason,
          NULL,
          jsonb_build_object(
            'decision', decision.decision,
            'scorecardId', decision.scorecard_id::text
          ),
          COALESCE(decision.metadata, '{}'::jsonb) || jsonb_build_object('decisionId', decision.id::text),
          decision.created_at
        FROM hiring_decisions decision
        WHERE decision.organization_id = ${organizationId}::uuid

        UNION ALL

        SELECT
          'candidate_criterion_evaluations',
          evaluation.id::text,
          evaluation.evaluator_type::text,
          NULL,
          'evaluation.criterion_recorded',
          'application',
          evaluation.application_id::text,
          evaluation.rationale,
          NULL,
          jsonb_build_object(
            'score', evaluation.score,
            'confidence', evaluation.confidence,
            'reviewState', evaluation.review_state
          ),
          jsonb_build_object(
            'evaluationId', evaluation.id::text,
            'rubricVersionId', evaluation.rubric_version_id::text,
            'criterionId', evaluation.criterion_id::text,
            'evaluatorVersion', evaluation.evaluator_version,
            'evidenceIds', to_jsonb(evaluation.evidence_ids)
          ),
          evaluation.created_at
        FROM candidate_criterion_evaluations evaluation
        WHERE evaluation.organization_id = ${organizationId}::uuid

        UNION ALL

        SELECT
          'scorecards',
          scorecard.id::text,
          'system',
          NULL,
          'scorecard.created',
          'application',
          scorecard.application_id::text,
          NULL,
          NULL,
          jsonb_build_object(
            'overallScore', scorecard.overall_score,
            'recommendation', scorecard.recommendation,
            'reviewState', scorecard.review_state
          ),
          jsonb_build_object(
            'scorecardId', scorecard.id::text,
            'rubricVersionId', scorecard.rubric_version_id::text,
            'algorithmVersion', scorecard.algorithm_version
          ),
          scorecard.created_at
        FROM scorecards scorecard
        WHERE scorecard.organization_id = ${organizationId}::uuid

        UNION ALL

        SELECT
          'score_overrides',
          override.id::text,
          'user',
          override.actor_user_id::text,
          'score.override_recorded',
          'scorecard',
          override.scorecard_id::text,
          override.reason,
          jsonb_build_object('overallScore', override.previous_score),
          jsonb_build_object('overallScore', override.new_score),
          jsonb_build_object('overrideId', override.id::text),
          override.created_at
        FROM score_overrides override
        WHERE override.organization_id = ${organizationId}::uuid

        UNION ALL

        SELECT
          'ai_executions',
          execution.id::text,
          'ai',
          NULL,
          'ai.execution',
          'ai_execution',
          execution.id::text,
          execution.error_message,
          NULL,
          execution.structured_output,
          jsonb_build_object(
            'capability', execution.capability,
            'provider', execution.provider,
            'model', execution.model,
            'promptVersion', execution.prompt_version,
            'status', execution.status,
            'inputReferences', execution.input_references,
            'promptTokens', execution.prompt_tokens,
            'completionTokens', execution.completion_tokens,
            'latencyMs', execution.latency_ms,
            'completedAt', execution.completed_at
          ),
          execution.created_at
        FROM ai_executions execution
        WHERE execution.organization_id = ${organizationId}::uuid

        UNION ALL

        SELECT
          'automation_runs',
          run.id::text,
          'system',
          NULL,
          'automation.run',
          'automation_run',
          run.id::text,
          run.error_message,
          jsonb_build_object('state', 'created'),
          jsonb_build_object('state', run.state),
          jsonb_build_object(
            'ruleId', run.rule_id::text,
            'triggerReference', run.trigger_reference,
            'idempotencyKey', run.idempotency_key,
            'input', run.input,
            'output', run.output,
            'approvedByUserId', run.approved_by_user_id::text,
            'approvedAt', run.approved_at,
            'startedAt', run.started_at,
            'completedAt', run.completed_at
          ),
          run.created_at
        FROM automation_runs run
        WHERE run.organization_id = ${organizationId}::uuid

        UNION ALL

        SELECT
          'candidate_consent_receipts',
          receipt.id::text,
          'candidate',
          NULL,
          CASE WHEN receipt.granted THEN 'consent.granted' ELSE 'consent.declined' END,
          'application',
          receipt.application_id::text,
          NULL,
          NULL,
          jsonb_build_object(
            'consentType', receipt.consent_type,
            'noticeVersion', receipt.notice_version,
            'granted', receipt.granted
          ),
          COALESCE(receipt.metadata, '{}'::jsonb) || jsonb_build_object(
            'candidateId', receipt.candidate_id::text,
            'candidateIdentityId', receipt.candidate_identity_id::text,
            'grantedAt', receipt.granted_at,
            'withdrawnAt', receipt.withdrawn_at,
            'consentReceiptId', receipt.id::text
          ),
          receipt.created_at
        FROM candidate_consent_receipts receipt
        WHERE receipt.organization_id = ${organizationId}::uuid

        UNION ALL

        SELECT
          'privacy_requests',
          request.id::text,
          CASE WHEN request.reviewed_by_user_id IS NULL THEN 'candidate' ELSE 'user' END,
          request.reviewed_by_user_id::text,
          ('privacy.request.' || request.request_type)::text,
          'privacy_request',
          request.id::text,
          request.review_notes,
          NULL,
          jsonb_build_object(
            'status', request.status,
            'completedAt', request.completed_at
          ),
          COALESCE(request.metadata, '{}'::jsonb) || jsonb_build_object(
            'candidateId', request.candidate_id::text,
            'requestedAt', request.requested_at
          ),
          request.requested_at
        FROM privacy_requests request
        WHERE request.organization_id = ${organizationId}::uuid

        UNION ALL

        SELECT
          'retention_jobs',
          job.id::text,
          'system',
          NULL,
          'retention.cycle',
          'retention_job',
          job.id::text,
          job.last_error,
          jsonb_build_object('state', 'queued'),
          jsonb_build_object('state', job.state, 'dryRun', job.dry_run),
          jsonb_build_object(
            'cycleKey', job.cycle_key,
            'attemptCount', job.attempt_count,
            'maxAttempts', job.max_attempts,
            'policySnapshot', job.policy_snapshot,
            'result', job.result,
            'lastErrorCode', job.last_error_code,
            'startedAt', job.started_at,
            'completedAt', job.completed_at
          ),
          job.created_at
        FROM retention_jobs job
        WHERE job.organization_id = ${organizationId}::uuid

        UNION ALL

        SELECT
          'retention_job_items',
          item.id::text,
          'system',
          NULL,
          'retention.policy_execution',
          item.entity_type::text,
          item.retention_job_id::text,
          NULL,
          NULL,
          jsonb_build_object(
            'status', item.status,
            'eligibleCount', item.eligible_count,
            'deletedCount', item.deleted_count,
            'heldCount', item.held_count,
            'delegatedCount', item.delegated_count
          ),
          COALESCE(item.details, '{}'::jsonb) || jsonb_build_object(
            'retentionJobItemId', item.id::text,
            'cutoffAt', item.cutoff_at
          ),
          item.created_at
        FROM retention_job_items item
        WHERE item.organization_id = ${organizationId}::uuid
      )
      SELECT *
      FROM unified
      WHERE (${from}::timestamptz IS NULL OR created_at >= ${from}::timestamptz)
        AND (${to}::timestamptz IS NULL OR created_at <= ${to}::timestamptz)
        AND (${query.action ?? null}::text IS NULL OR action = ${query.action ?? null})
        AND (${query.entityType ?? null}::text IS NULL OR entity_type = ${query.entityType ?? null})
      ORDER BY created_at DESC, id DESC
      LIMIT ${rowLimit}
    `) as unknown as Array<Record<string, unknown>>;

    const truncated = requestedLimit !== null && rows.length > requestedLimit;
    const selected = truncated && requestedLimit !== null ? rows.slice(0, requestedLimit) : rows;
    const counts = sourceCounts(selected);
    const events = selected.map((row) => {
      const metadata = nullableSanitizedRecord(row.metadata) ?? {};
      metadata.sourceLedger = String(row.source_ledger);
      return {
        id: String(row.id),
        actorType: String(row.actor_type),
        actorUserId: row.actor_user_id ? String(row.actor_user_id) : null,
        action: String(row.action),
        entityType: String(row.entity_type),
        entityId: row.entity_id ? String(row.entity_id) : null,
        reason: row.reason ? String(row.reason) : null,
        before: nullableSanitizedRecord(row.before),
        after: nullableSanitizedRecord(row.after),
        metadata,
        createdAt: new Date(String(row.created_at)).toISOString(),
      };
    });
    const integritySha256 = createHash("sha256").update(JSON.stringify(events)).digest("hex");
    const exportedAt = new Date().toISOString();

    const result = {
      exportedAt,
      organizationId,
      filters: {
        from,
        to,
        action: query.action ?? null,
        entityType: query.entityType ?? null,
        limit: requestedLimit,
        manifest: {
          exportVersion: AUDIT_EXPORT_VERSION,
          completeByDefault: requestedLimit === null,
          redactionPolicy: "recursive-sensitive-key-redaction-v1",
          integrity: { algorithm: "sha256", digest: integritySha256 },
          sourceCounts: counts,
        },
      },
      count: events.length,
      truncated,
      events,
    };

    await this.record({
      action: "audit.export.generated",
      entityType: "audit_export",
      reason: "Organization audit export generated",
      metadata: {
        exportVersion: AUDIT_EXPORT_VERSION,
        exportedAt,
        from,
        to,
        action: query.action ?? null,
        entityType: query.entityType ?? null,
        requestedLimit,
        count: events.length,
        truncated,
        sourceCounts: counts,
        integritySha256,
      },
    });

    return result;
  }
}

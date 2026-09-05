import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import { CandidateIntents, type CandidateIntent } from "./interview-contracts";
import {
  decideInterviewTurn,
  type InterviewBrainCriterion,
  type InterviewBrainState,
} from "./interview-brain";
import { evaluateInterviewRelease, parseInterviewLifecycleStage } from "./interview-release.policy";

const BRAIN_VERSION = "deterministic-state-machine-v1";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function positiveInteger(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.trunc(value));
}

function strategyForCriterion(
  questionStrategy: Record<string, unknown>,
  criterionKey: string,
): Record<string, unknown> {
  const criteria = asRecord(questionStrategy.criteria);
  return asRecord(criteria[criterionKey]);
}

@Injectable()
export class InterviewBrainService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async nextTurn(sessionId: string, body: unknown) {
    if (!body || typeof body !== "object") throw new Error("Interview brain input is required");
    const value = body as Record<string, unknown>;
    const latestCandidateText =
      typeof value.latestCandidateText === "string" ? value.latestCandidateText : "";
    const elapsedSeconds = value.elapsedSeconds === undefined ? 0 : Number(value.elapsedSeconds);
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0 || elapsedSeconds > 600) {
      throw new Error("elapsedSeconds must be between 0 and 600");
    }

    let candidateIntent: CandidateIntent | null = null;
    if (value.candidateIntent !== undefined && value.candidateIntent !== null) {
      if (typeof value.candidateIntent !== "string") throw new Error("candidateIntent must be a string");
      if (!CandidateIntents.includes(value.candidateIntent as CandidateIntent)) {
        throw new Error("Unsupported candidate intent");
      }
      candidateIntent = value.candidateIntent as CandidateIntent;
    }

    const organizationId = this.tenantContext.require().organizationId;
    return this.database.sql.begin(async (transaction) => {
      const sessionRows = await transaction`
        SELECT
          s.id,
          s.status,
          s.current_criterion_key,
          s.remaining_seconds,
          s.reconnect_count,
          s.checkpoint,
          p.rubric_version_id,
          p.question_strategy,
          r.lifecycle_stage,
          r.production_approved_at,
          r.production_approved_by_user_id
        FROM interview_sessions s
        JOIN interview_plans p
          ON p.organization_id = s.organization_id AND p.id = s.interview_plan_id
        JOIN interview_release_units r
          ON r.organization_id = p.organization_id AND r.id = p.release_unit_id
        WHERE s.organization_id = ${organizationId}::uuid
          AND s.id = ${sessionId}::uuid
        FOR UPDATE OF s
      `;
      if (!sessionRows.length) throw new Error("Interview session not found");

      const session = sessionRows[0];
      const checkpoint = asRecord(session?.checkpoint);
      if (checkpoint.candidateIsRealCustomerCandidate === true) {
        throw new Error(
          "The deterministic development brain endpoint cannot run a real-customer candidate session",
        );
      }

      const lifecycleStage = parseInterviewLifecycleStage(session?.lifecycle_stage);
      const release = evaluateInterviewRelease({
        lifecycleStage,
        productionApprovedAt: session?.production_approved_at
          ? String(session.production_approved_at)
          : null,
        productionApprovedByUserId: session?.production_approved_by_user_id
          ? String(session.production_approved_by_user_id)
          : null,
        candidateIsRealCustomerCandidate: false,
        synchronousHumanSupervisorPresent: false,
      });
      if (!release.allowed) throw new Error(`Interview release blocked: ${release.reasons.join("; ")}`);

      if (String(session?.status) !== "in_progress") {
        throw new Error(
          `Interview brain requires an in_progress session; current status is ${String(session?.status)}`,
        );
      }

      const criterionRows = await transaction`
        SELECT criterion_key, label, description, evidence_policy, display_order
        FROM rubric_criteria
        WHERE organization_id = ${organizationId}::uuid
          AND rubric_version_id = ${String(session?.rubric_version_id)}::uuid
          AND required = true
        ORDER BY display_order, criterion_key
      `;
      const questionStrategy = asRecord(session?.question_strategy);
      const requiredKeys = new Set(asStringArray(questionStrategy.requiredCriteria));
      const criteria: InterviewBrainCriterion[] = criterionRows
        .filter((row) => requiredKeys.size === 0 || requiredKeys.has(String(row.criterion_key)))
        .map((row) => {
          const key = String(row.criterion_key);
          const strategy = strategyForCriterion(questionStrategy, key);
          const evidencePolicy = asRecord(row.evidence_policy);
          const label = String(row.label);
          const description = String(row.description ?? "").trim();
          const expectedEvidence = asStringArray(strategy.expectedEvidence);
          return {
            key,
            label,
            objective:
              typeof strategy.objective === "string" && strategy.objective.trim()
                ? strategy.objective.trim()
                : description || `validate_${key}`,
            expectedEvidence:
              expectedEvidence.length > 0
                ? expectedEvidence
                : [description || `Concrete job-relevant evidence for ${label}`],
            minimumEvidence: positiveInteger(evidencePolicy.minimumEvidence, 1),
          };
        });

      const evidenceRows = await transaction`
        SELECT rc.criterion_key, count(*)::int AS evidence_count
        FROM interview_evidence e
        JOIN rubric_criteria rc
          ON rc.organization_id = e.organization_id AND rc.id = e.criterion_id
        WHERE e.organization_id = ${organizationId}::uuid
          AND e.interview_session_id = ${sessionId}::uuid
        GROUP BY rc.criterion_key
      `;
      const evidenceCoverage: Record<string, number> = {};
      for (const row of evidenceRows) {
        evidenceCoverage[String(row.criterion_key)] = Number(row.evidence_count ?? 0);
      }

      const priorTurnRows = await transaction`
        SELECT sequence, criterion_key, action
        FROM interview_turns
        WHERE organization_id = ${organizationId}::uuid
          AND interview_session_id = ${sessionId}::uuid
        ORDER BY sequence
      `;
      const askedQuestionIds = priorTurnRows.map((row) =>
        `${row.criterion_key ? String(row.criterion_key) : "session"}:${String(row.action)}:${Number(row.sequence) + 1}`,
      );
      const state: InterviewBrainState = {
        currentCriterion: session?.current_criterion_key
          ? String(session.current_criterion_key)
          : null,
        askedQuestionIds,
        evidenceCoverage,
        remainingSeconds: Math.max(0, Number(session?.remaining_seconds ?? 0)),
        reconnectCount: Math.max(0, Number(session?.reconnect_count ?? 0)),
      };

      const decision = decideInterviewTurn({
        criteria,
        state,
        latestCandidateText,
        candidateIntent,
        elapsedSeconds,
      });
      const sequence = priorTurnRows.length
        ? Number(priorTurnRows[priorTurnRows.length - 1]?.sequence ?? -1) + 1
        : 0;

      const inserted = await transaction`
        INSERT INTO interview_turns (
          organization_id,
          interview_session_id,
          sequence,
          candidate_intent,
          action,
          criterion_key,
          objective,
          spoken_text,
          expected_evidence,
          interviewer_trace_reference,
          finalized
        ) VALUES (
          ${organizationId}::uuid,
          ${sessionId}::uuid,
          ${sequence},
          ${candidateIntent},
          ${decision.turn.action},
          ${decision.turn.criterion},
          ${decision.turn.objective},
          ${decision.turn.spokenText},
          ${this.database.sql.json(decision.turn.expectedEvidence as never)},
          ${BRAIN_VERSION},
          true
        )
        RETURNING id, created_at
      `;

      const nextCheckpoint = {
        ...checkpoint,
        brain: {
          version: BRAIN_VERSION,
          lastQuestionId: decision.questionId,
          lastReason: decision.reason,
          askedQuestionIds: decision.nextState.askedQuestionIds,
          evidenceCoverage: decision.nextState.evidenceCoverage,
        },
      };
      await transaction`
        UPDATE interview_sessions
        SET
          current_criterion_key = ${decision.nextState.currentCriterion},
          remaining_seconds = ${decision.nextState.remainingSeconds},
          checkpoint = ${this.database.sql.json(nextCheckpoint as never)},
          updated_at = now()
        WHERE organization_id = ${organizationId}::uuid
          AND id = ${sessionId}::uuid
      `;

      return {
        id: String(inserted[0]?.id),
        sequence,
        questionId: decision.questionId,
        action: decision.turn.action,
        criterion: decision.turn.criterion,
        objective: decision.turn.objective,
        spokenText: decision.turn.spokenText,
        expectedEvidence: decision.turn.expectedEvidence,
        ...(candidateIntent ? { candidateIntent } : {}),
        finalized: true,
        brainVersion: BRAIN_VERSION,
        brainReason: decision.reason,
        remainingSeconds: decision.nextState.remainingSeconds,
        evidenceCoverage: decision.nextState.evidenceCoverage,
        releaseMode: release.mode,
        createdAt: new Date(String(inserted[0]?.created_at)).toISOString(),
      };
    });
  }
}

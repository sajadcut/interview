import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import { CandidateIntents, type CandidateIntent, type StructuredInterviewTurn } from "./interview-contracts";
import {
  decideInterviewTurn,
  type InterviewBrainCriterion,
  type InterviewBrainState,
} from "./interview-brain";
import { normalizeInterviewSpokenLanguage } from "./interview-language";
import {
  LlmInterviewerFailure,
  LlmInterviewerService,
  LLM_INTERVIEWER_PROMPT_ID,
  LLM_INTERVIEWER_PROMPT_VERSION,
  type ConversationalInterviewerTrace,
} from "./llm-interviewer.service";
import {
  enforceInterviewTurnPolicy,
  type InterviewPolicyContext,
  type InterviewPolicyPriorTurn,
} from "./interview-policy-firewall";
import { evaluateInterviewRelease, parseInterviewLifecycleStage } from "./interview-release.policy";

const BRAIN_VERSION = "llm-conversational-orchestrator-v1";
const DETERMINISTIC_FALLBACK_VERSION = "deterministic-state-machine-v1";
const DEFAULT_HISTORY_TURNS = 8;

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

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(parsed)));
}

function boundedText(value: unknown, maximum: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length <= maximum ? text : `${text.slice(0, Math.max(0, maximum - 1))}…`;
}

function strategyForCriterion(
  questionStrategy: Record<string, unknown>,
  criterionKey: string,
): Record<string, unknown> {
  const criteria = asRecord(questionStrategy.criteria);
  return asRecord(criteria[criterionKey]);
}

function finalQuestionId(turn: StructuredInterviewTurn, sequence: number): string {
  return `${turn.criterion ?? "session"}:${turn.action}:${sequence + 1}`;
}

function traceReference(input: {
  mode: "llm" | "deterministic_fallback";
  provider?: string;
  promptVersion?: string;
  fallbackReason?: string;
  policyVersion: string;
}): string {
  const raw = input.mode === "llm"
    ? `llm:${input.provider ?? "unknown"}:${input.promptVersion ?? "unknown"}:${input.policyVersion}`
    : `deterministic_fallback:${input.fallbackReason ?? "llm_not_attempted"}:${input.policyVersion}`;
  return raw.slice(0, 512);
}

@Injectable()
export class InterviewBrainService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
    private readonly llmInterviewer: LlmInterviewerService,
  ) {}

  async readiness() {
    const llm = await this.llmInterviewer.readiness();
    return {
      brainVersion: BRAIN_VERSION,
      enabled: llm.enabled,
      configured: llm.configured,
      reachable: llm.reachable,
      ready: llm.ready,
      provider: llm.provider,
      ...(llm.model ? { model: llm.model } : {}),
      promptId: llm.promptId,
      promptVersion: llm.promptVersion,
      fallbackAvailable: true,
      fallbackVersion: DETERMINISTIC_FALLBACK_VERSION,
      ...(llm.reason ? { reason: llm.reason } : {}),
    };
  }

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
          p.job_id,
          p.rubric_version_id,
          p.version AS plan_version,
          p.language,
          p.interview_type,
          p.time_budget_minutes,
          p.question_strategy,
          p.forbidden_topics,
          j.title AS job_title,
          j.department AS job_department,
          j.seniority AS job_seniority,
          j.summary AS job_summary,
          r.lifecycle_stage,
          r.production_approved_at,
          r.production_approved_by_user_id
        FROM interview_sessions s
        JOIN interview_plans p
          ON p.organization_id = s.organization_id AND p.id = s.interview_plan_id
        JOIN jobs j
          ON j.organization_id = p.organization_id AND j.id = p.job_id
        JOIN interview_release_units r
          ON r.organization_id = p.organization_id AND r.id = p.release_unit_id
        WHERE s.organization_id = ${organizationId}::uuid
          AND s.id = ${sessionId}::uuid
        FOR UPDATE OF s
      `;
      if (!sessionRows.length) throw new Error("Interview session not found");

      const session = sessionRows[0];
      const language = normalizeInterviewSpokenLanguage(session?.language);
      const checkpoint = asRecord(session?.checkpoint);
      const candidateIsRealCustomerCandidate = checkpoint.candidateIsRealCustomerCandidate === true;
      const lifecycleStage = parseInterviewLifecycleStage(session?.lifecycle_stage);
      const release = evaluateInterviewRelease({
        lifecycleStage,
        productionApprovedAt: session?.production_approved_at
          ? String(session.production_approved_at)
          : null,
        productionApprovedByUserId: session?.production_approved_by_user_id
          ? String(session.production_approved_by_user_id)
          : null,
        candidateIsRealCustomerCandidate,
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
          const spokenLabel =
            typeof strategy.spokenLabel === "string" && strategy.spokenLabel.trim()
              ? strategy.spokenLabel.trim()
              : undefined;
          return {
            key,
            label,
            ...(spokenLabel ? { spokenLabel } : {}),
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
      for (const row of evidenceRows) evidenceCoverage[String(row.criterion_key)] = Number(row.evidence_count ?? 0);

      const priorTurnRows = await transaction`
        SELECT sequence, criterion_key, action, objective, spoken_text
        FROM interview_turns
        WHERE organization_id = ${organizationId}::uuid
          AND interview_session_id = ${sessionId}::uuid
        ORDER BY sequence
      `;
      const askedQuestionIds = priorTurnRows.map((row) =>
        `${row.criterion_key ? String(row.criterion_key) : "session"}:${String(row.action)}:${Number(row.sequence) + 1}`,
      );
      const state: InterviewBrainState = {
        currentCriterion: session?.current_criterion_key ? String(session.current_criterion_key) : null,
        askedQuestionIds,
        evidenceCoverage,
        remainingSeconds: Math.max(0, Number(session?.remaining_seconds ?? 0)),
        reconnectCount: Math.max(0, Number(session?.reconnect_count ?? 0)),
      };

      const deterministic = decideInterviewTurn({
        criteria,
        state,
        latestCandidateText,
        candidateIntent,
        elapsedSeconds,
        language,
      });
      const sequence = priorTurnRows.length
        ? Number(priorTurnRows[priorTurnRows.length - 1]?.sequence ?? -1) + 1
        : 0;
      const policyContext: InterviewPolicyContext = {
        criteria: criteria.map((item) => ({ key: item.key, objective: item.objective })),
        forbiddenTopics: session?.forbidden_topics,
        priorTurns: priorTurnRows.map((row): InterviewPolicyPriorTurn => ({
          action: String(row.action),
          criterion: row.criterion_key ? String(row.criterion_key) : null,
          objective: row.objective ? String(row.objective) : null,
          spokenText: String(row.spoken_text ?? ""),
        })),
        remainingSeconds: deterministic.nextState.remainingSeconds,
        candidateIntent,
        latestCandidateText,
        language,
      };

      let selectedTurn = deterministic.turn;
      let brainMode: "llm" | "deterministic_fallback" = "deterministic_fallback";
      let llmTrace: ConversationalInterviewerTrace | null = null;
      let fallbackReason = candidateIntent && candidateIntent !== "ANSWER"
        ? `deterministic_operational_intent:${candidateIntent}`
        : deterministic.turn.action === "close"
          ? "deterministic_terminal_state"
          : "llm_not_attempted";
      let llmPolicyViolations: string[] = [];

      const conversationalIntent = candidateIntent === null || candidateIntent === "ANSWER";
      const llmEligible = conversationalIntent && deterministic.turn.action !== "close" && criteria.length > 0;
      if (llmEligible) {
        const historyLimit = boundedInteger(
          process.env.AI_INTERVIEWER_HISTORY_TURNS,
          DEFAULT_HISTORY_TURNS,
          4,
          16,
        );
        const recentRows = await transaction`
          SELECT speaker, text
          FROM interview_transcript_segments
          WHERE organization_id = ${organizationId}::uuid
            AND interview_session_id = ${sessionId}::uuid
            AND is_final = true
            AND speaker IN ('candidate', 'interviewer')
          ORDER BY start_ms DESC, created_at DESC, id DESC
          LIMIT ${historyLimit}
        `;
        const requirements = await transaction`
          SELECT requirement_type, name, description
          FROM job_requirements
          WHERE organization_id = ${organizationId}::uuid
            AND job_id = ${String(session?.job_id)}::uuid
          ORDER BY weight DESC, created_at
          LIMIT 8
        `;
        const closeObjectives = ["respect_time_budget", "complete_evidence_coverage"];
        try {
          const generated = await this.llmInterviewer.generateTurn({
            sessionId,
            sequence,
            language,
            latestCandidateText: boundedText(latestCandidateText, 1600),
            candidateIntent,
            currentCriterion: state.currentCriterion,
            remainingSeconds: deterministic.nextState.remainingSeconds,
            criteria: criteria.map((criterion) => ({
              key: criterion.key,
              label: boundedText(criterion.label, 240),
              ...(criterion.spokenLabel ? { spokenLabel: boundedText(criterion.spokenLabel, 240) } : {}),
              objective: criterion.objective,
              expectedEvidence: criterion.expectedEvidence.slice(0, 8).map((item) => boundedText(item, 500)),
              minimumEvidence: criterion.minimumEvidence,
              evidenceCount: Math.max(0, evidenceCoverage[criterion.key] ?? 0),
            })),
            evidenceGaps: criteria
              .filter((criterion) => (evidenceCoverage[criterion.key] ?? 0) < criterion.minimumEvidence)
              .map((criterion) => criterion.key),
            recentTranscript: [...recentRows]
              .reverse()
              .map((row) => ({
                speaker: String(row.speaker) as "candidate" | "interviewer",
                text: boundedText(row.text, 1200),
              })),
            job: {
              title: boundedText(session?.job_title, 240),
              ...(session?.job_department ? { department: boundedText(session.job_department, 160) } : {}),
              ...(session?.job_seniority ? { seniority: boundedText(session.job_seniority, 80) } : {}),
              ...(session?.job_summary ? { summary: boundedText(session.job_summary, 1600) } : {}),
              requirements: requirements.map((row) => ({
                type: boundedText(row.requirement_type, 24),
                name: boundedText(row.name, 240),
                ...(row.description ? { description: boundedText(row.description, 500) } : {}),
              })),
            },
            plan: {
              version: Number(session?.plan_version ?? 1),
              interviewType: boundedText(session?.interview_type, 80),
              timeBudgetMinutes: Number(session?.time_budget_minutes ?? 0),
            },
            deterministicRecommendation: {
              action: deterministic.turn.action,
              criterion: deterministic.turn.criterion,
              objective: deterministic.turn.objective,
              expectedEvidence: deterministic.turn.expectedEvidence,
            },
            closeObjectives,
          });
          const llmPolicy = enforceInterviewTurnPolicy(generated.turn, policyContext);
          if (llmPolicy.decision === "accepted") {
            selectedTurn = llmPolicy.turn;
            brainMode = "llm";
            llmTrace = generated.trace;
            fallbackReason = "";
          } else {
            llmPolicyViolations = llmPolicy.violations;
            fallbackReason = `policy_rejection:${llmPolicy.violations.join("+")}`.slice(0, 240);
          }
        } catch (cause) {
          fallbackReason = cause instanceof LlmInterviewerFailure
            ? cause.code
            : "unexpected_provider_failure";
        }
      }

      const policy = enforceInterviewTurnPolicy(selectedTurn, policyContext);
      const finalTurn = policy.turn;
      if (brainMode === "llm" && policy.decision !== "accepted") {
        brainMode = "deterministic_fallback";
        fallbackReason = `policy_rejection:${policy.violations.join("+")}`.slice(0, 240);
        const fallbackPolicy = enforceInterviewTurnPolicy(deterministic.turn, policyContext);
        selectedTurn = fallbackPolicy.turn;
        llmPolicyViolations = policy.violations;
      } else {
        selectedTurn = finalTurn;
      }
      const finalPolicy = brainMode === "llm"
        ? policy
        : enforceInterviewTurnPolicy(selectedTurn, policyContext);
      const turn = finalPolicy.turn;
      const questionId = finalQuestionId(turn, sequence);
      const trace = brainMode === "llm" && llmTrace
        ? {
            mode: brainMode,
            provider: llmTrace.provider,
            ...(llmTrace.model ? { model: llmTrace.model } : {}),
            promptId: llmTrace.promptId,
            promptVersion: llmTrace.promptVersion,
            reason: llmTrace.reason,
          }
        : {
            mode: "deterministic_fallback" as const,
            provider: "none",
            promptId: LLM_INTERVIEWER_PROMPT_ID,
            promptVersion: LLM_INTERVIEWER_PROMPT_VERSION,
            reason: deterministic.reason,
            fallbackReason: fallbackReason || "deterministic_fallback",
          };

      const inserted = await transaction`
        INSERT INTO interview_turns (
          organization_id, interview_session_id, sequence, candidate_intent, action,
          criterion_key, objective, spoken_text, expected_evidence,
          interviewer_trace_reference, finalized
        ) VALUES (
          ${organizationId}::uuid, ${sessionId}::uuid, ${sequence}, ${candidateIntent},
          ${turn.action}, ${turn.criterion}, ${turn.objective},
          ${turn.spokenText},
          ${this.database.sql.json(turn.expectedEvidence as never)},
          ${traceReference({
            mode: brainMode,
            ...(brainMode === "llm" && llmTrace ? { provider: llmTrace.provider, promptVersion: llmTrace.promptVersion } : {}),
            ...(brainMode === "deterministic_fallback" ? { fallbackReason: trace.fallbackReason } : {}),
            policyVersion: finalPolicy.policyVersion,
          })}, true
        )
        RETURNING id, created_at
      `;

      const nextCheckpoint = {
        ...checkpoint,
        brain: {
          version: BRAIN_VERSION,
          fallbackVersion: DETERMINISTIC_FALLBACK_VERSION,
          language,
          mode: brainMode,
          provider: trace.provider,
          promptId: trace.promptId,
          promptVersion: trace.promptVersion,
          lastQuestionId: questionId,
          lastReason: trace.reason,
          ...(trace.fallbackReason ? { fallbackReason: trace.fallbackReason } : {}),
          askedQuestionIds: [...state.askedQuestionIds, questionId],
          evidenceCoverage,
        },
        policy: {
          version: finalPolicy.policyVersion,
          decision: finalPolicy.decision,
          violations: finalPolicy.violations,
          ...(llmPolicyViolations.length ? { rejectedLlmViolations: llmPolicyViolations } : {}),
        },
      };
      await transaction`
        UPDATE interview_sessions
        SET current_criterion_key = ${turn.criterion},
            remaining_seconds = ${deterministic.nextState.remainingSeconds},
            checkpoint = ${this.database.sql.json(nextCheckpoint as never)},
            updated_at = now()
        WHERE organization_id = ${organizationId}::uuid AND id = ${sessionId}::uuid
      `;

      return {
        id: String(inserted[0]?.id),
        sequence,
        questionId,
        action: turn.action,
        criterion: turn.criterion,
        objective: turn.objective,
        spokenText: turn.spokenText,
        expectedEvidence: turn.expectedEvidence,
        ...(candidateIntent ? { candidateIntent } : {}),
        finalized: true,
        brainVersion: BRAIN_VERSION,
        brainMode,
        brainReason: trace.reason,
        brainProvider: trace.provider,
        brainPromptId: trace.promptId,
        brainPromptVersion: trace.promptVersion,
        ...(trace.fallbackReason ? { brainFallbackReason: trace.fallbackReason } : {}),
        language,
        remainingSeconds: deterministic.nextState.remainingSeconds,
        evidenceCoverage,
        releaseMode: release.mode,
        policyVersion: finalPolicy.policyVersion,
        policyDecision: finalPolicy.decision,
        policyViolations: finalPolicy.violations,
        createdAt: new Date(String(inserted[0]?.created_at)).toISOString(),
      };
    });
  }
}

import { createHash } from "node:crypto";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import {
  INTERVIEW_EVALUATOR_INPUT_SCHEMA,
  InterviewEvaluationValidationError,
  evaluateInterviewDraft,
  parseInterviewEvaluatorDraft,
  type InterviewEvaluatorInput,
  type InterviewEvaluatorOutput,
} from "./interview-evaluator";

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

@Injectable()
export class InterviewEvaluatorService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async buildInput(sessionId: string): Promise<InterviewEvaluatorInput> {
    const organizationId = this.tenantContext.require().organizationId;
    const sessions = await this.database.sql`
      SELECT s.id::text, s.status, s.application_id::text,
             p.rubric_version_id::text, p.version AS plan_version,
             r.evaluator_version
      FROM interview_sessions s
      JOIN interview_plans p
        ON p.organization_id = s.organization_id AND p.id = s.interview_plan_id
      JOIN interview_release_units r
        ON r.organization_id = p.organization_id AND r.id = p.release_unit_id
      WHERE s.organization_id = ${organizationId}::uuid
        AND s.id = ${sessionId}::uuid
      LIMIT 1
    `;
    const session = sessions[0];
    if (!session) throw new NotFoundException("Interview session not found");

    const rubricVersionId = String(session.rubric_version_id);
    const criteriaRows = await this.database.sql`
      SELECT id::text, criterion_key, label, description, weight, required,
             evidence_policy, display_order
      FROM rubric_criteria
      WHERE organization_id = ${organizationId}::uuid
        AND rubric_version_id = ${rubricVersionId}::uuid
      ORDER BY display_order, criterion_key
    `;
    if (criteriaRows.length === 0) {
      throw new BadRequestException("Interview rubric has no criteria to evaluate");
    }

    const transcriptRows = await this.database.sql`
      SELECT id::text, speaker, start_ms, end_ms, text, stt_confidence
      FROM interview_transcript_segments
      WHERE organization_id = ${organizationId}::uuid
        AND interview_session_id = ${sessionId}::uuid
        AND is_final = true
      ORDER BY start_ms, id
    `;
    const evidenceRows = await this.database.sql`
      SELECT id::text, criterion_id::text, turn_id::text, transcript_segment_ids,
             summary, confidence
      FROM interview_evidence
      WHERE organization_id = ${organizationId}::uuid
        AND interview_session_id = ${sessionId}::uuid
      ORDER BY created_at, id
    `;

    return {
      schemaVersion: INTERVIEW_EVALUATOR_INPUT_SCHEMA,
      sessionId,
      applicationId: String(session.application_id),
      sessionStatus: String(session.status),
      rubricVersionId,
      planVersion: Number(session.plan_version),
      evaluatorVersion: String(session.evaluator_version),
      criteria: criteriaRows.map((row) => ({
        id: String(row.id),
        criterionKey: String(row.criterion_key),
        label: String(row.label),
        description: row.description ? String(row.description) : null,
        weight: Number(row.weight),
        required: Boolean(row.required),
        evidencePolicy: asObject(row.evidence_policy),
        displayOrder: Number(row.display_order),
      })),
      transcript: transcriptRows.map((row) => ({
        id: String(row.id),
        speaker: String(row.speaker) as "candidate" | "interviewer" | "system",
        startMs: Number(row.start_ms),
        endMs: Number(row.end_ms),
        text: String(row.text),
        isFinal: true as const,
        ...(row.stt_confidence !== null && row.stt_confidence !== undefined
          ? { sttConfidence: Number(row.stt_confidence) }
          : {}),
      })),
      evidence: evidenceRows.map((row) => ({
        id: String(row.id),
        criterionId: row.criterion_id ? String(row.criterion_id) : null,
        turnId: row.turn_id ? String(row.turn_id) : null,
        transcriptSegmentIds: stringArray(row.transcript_segment_ids),
        summary: String(row.summary),
        ...(row.confidence !== null && row.confidence !== undefined
          ? { confidence: Number(row.confidence) }
          : {}),
      })),
      boundaries: {
        evidenceOnly: true,
        unsupportedInference: "insufficient_evidence",
        recommendationIsDecisionSupport: true,
        finalHiringAuthority: "human",
      },
    };
  }

  async evaluateAndPersist(
    sessionId: string,
    rawDraft: unknown,
  ): Promise<{
    evaluationId: string;
    scorecardId: string | null;
    idempotentReplay: boolean;
    output: InterviewEvaluatorOutput;
  }> {
    const organizationId = this.tenantContext.require().organizationId;
    const input = await this.buildInput(sessionId);
    if (input.sessionStatus !== "completed") {
      throw new BadRequestException("Only completed interview sessions can be evaluated");
    }

    let draft;
    let output: InterviewEvaluatorOutput;
    try {
      draft = parseInterviewEvaluatorDraft(rawDraft);
      output = evaluateInterviewDraft(input, draft);
    } catch (error) {
      if (error instanceof InterviewEvaluationValidationError) {
        throw new BadRequestException({
          message: "Interview evaluator output failed validation",
          issues: error.issues,
        });
      }
      throw error;
    }

    const inputFingerprint = fingerprint(input);
    const draftFingerprint = fingerprint(draft);
    const inputReferences = {
      ...(draft.provenance.inputReferences ?? {}),
      interviewSessionId: input.sessionId,
      applicationId: input.applicationId,
      rubricVersionId: input.rubricVersionId,
      evidenceIds: input.evidence.map((item) => item.id),
      transcriptSegmentIds: input.transcript.map((item) => item.id),
      inputFingerprint,
      draftFingerprint,
    };

    return this.database.sql.begin(async (tx) => {
      const inserted = await tx`
        INSERT INTO interview_evaluations (
          organization_id, interview_session_id, rubric_version_id,
          evaluator_version, status, criterion_results, recommendation,
          evaluator_trace_reference, human_review_state, evidence_complete,
          calibration_reference, idempotency_key, input_fingerprint, draft_fingerprint,
          provider, model, prompt_version, input_references,
          overall_confidence, weighted_score, score_algorithm_version,
          validation_report, output_snapshot, requires_human_review
        ) VALUES (
          ${organizationId}::uuid,
          ${sessionId}::uuid,
          ${input.rubricVersionId}::uuid,
          ${input.evaluatorVersion},
          ${output.status},
          ${this.database.sql.json(output.criterionResults as never)},
          ${output.recommendation},
          ${draft.provenance.traceReference ?? null},
          'pending',
          ${output.evidenceComplete},
          ${draft.provenance.calibrationReference ?? null},
          ${draft.idempotencyKey},
          ${inputFingerprint},
          ${draftFingerprint},
          ${draft.provenance.provider},
          ${draft.provenance.model ?? null},
          ${draft.provenance.promptVersion},
          ${this.database.sql.json(inputReferences as never)},
          ${output.overallConfidence},
          ${output.overallScore},
          ${output.scoringAlgorithmVersion},
          ${this.database.sql.json(output.validation as never)},
          ${this.database.sql.json(output as never)},
          true
        )
        ON CONFLICT (organization_id, interview_session_id, idempotency_key)
          WHERE idempotency_key IS NOT NULL
        DO NOTHING
        RETURNING id::text
      `;

      if (!inserted[0]) {
        const existing = await tx`
          SELECT id::text, scorecard_id::text, output_snapshot,
                 input_fingerprint, draft_fingerprint
          FROM interview_evaluations
          WHERE organization_id = ${organizationId}::uuid
            AND interview_session_id = ${sessionId}::uuid
            AND idempotency_key = ${draft.idempotencyKey}
          LIMIT 1
        `;
        const row = existing[0];
        if (!row) throw new Error("Unable to resolve idempotent evaluator replay");
        if (
          String(row.input_fingerprint ?? "") !== inputFingerprint ||
          String(row.draft_fingerprint ?? "") !== draftFingerprint
        ) {
          throw new BadRequestException(
            "Evaluator idempotency key was already used with different input or output",
          );
        }
        return {
          evaluationId: String(row.id),
          scorecardId: row.scorecard_id ? String(row.scorecard_id) : null,
          idempotentReplay: true,
          output: row.output_snapshot as InterviewEvaluatorOutput,
        };
      }

      const evaluationId = String(inserted[0].id);
      for (const result of output.criterionResults) {
        if (result.status !== "scored" || result.score === null) continue;
        await tx`
          INSERT INTO candidate_criterion_evaluations (
            organization_id, application_id, rubric_version_id, criterion_id,
            evaluator_type, evaluator_version, score, confidence, rationale,
            evidence_ids, review_state
          ) VALUES (
            ${organizationId}::uuid,
            ${input.applicationId}::uuid,
            ${input.rubricVersionId}::uuid,
            ${result.criterionId}::uuid,
            'ai',
            ${input.evaluatorVersion},
            ${result.score},
            ${result.confidence},
            ${result.rationale},
            ${result.evidenceIds}::uuid[],
            'pending'
          )
        `;
      }

      let scorecardId: string | null = null;
      if (output.evidenceComplete && output.overallScore !== null) {
        const scorecards = await tx`
          INSERT INTO scorecards (
            organization_id, application_id, rubric_version_id,
            overall_score, recommendation, algorithm_version, review_state
          ) VALUES (
            ${organizationId}::uuid,
            ${input.applicationId}::uuid,
            ${input.rubricVersionId}::uuid,
            ${output.overallScore},
            ${output.recommendation},
            ${output.scoringAlgorithmVersion},
            'pending'
          )
          RETURNING id::text
        `;
        scorecardId = scorecards[0] ? String(scorecards[0].id) : null;
        if (scorecardId) {
          await tx`
            UPDATE interview_evaluations
            SET scorecard_id = ${scorecardId}::uuid, updated_at = now()
            WHERE organization_id = ${organizationId}::uuid
              AND id = ${evaluationId}::uuid
          `;
        }
      }

      return {
        evaluationId,
        scorecardId,
        idempotentReplay: false,
        output,
      };
    });
  }
}

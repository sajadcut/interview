import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import {
  buildConfidenceCalibration,
  calculateRankingAgreement,
  type CalibrationConfidenceObservation,
  type CalibrationRankingPair,
} from "./evaluator-calibration-analytics";

interface StoredComparison {
  criterionKey: string;
  referenceScore: number;
  aiScore: number | null;
  absoluteDelta: number;
  withinTolerance: boolean;
  aiConfidence: number | null;
}

function asComparisons(value: unknown): StoredComparison[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    if (
      typeof row.criterionKey !== "string" ||
      typeof row.referenceScore !== "number" ||
      typeof row.absoluteDelta !== "number" ||
      typeof row.withinTolerance !== "boolean"
    ) return [];
    return [{
      criterionKey: row.criterionKey,
      referenceScore: row.referenceScore,
      aiScore: typeof row.aiScore === "number" ? row.aiScore : null,
      absoluteDelta: row.absoluteDelta,
      withinTolerance: row.withinTolerance,
      aiConfidence: typeof row.aiConfidence === "number" ? row.aiConfidence : null,
    }];
  });
}

function percentile(values: number[], percentileValue: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * percentileValue;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return Math.round(sorted[lower]! * 10000) / 10000;
  const interpolated = sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
  return Math.round(interpolated * 10000) / 10000;
}

@Injectable()
export class EvaluatorCalibrationAnalyticsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async analyze(datasetId: string, evaluatorVersion: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const version = evaluatorVersion.trim();
    if (!version) throw new BadRequestException("evaluatorVersion is required");
    const datasets = await this.database.sql`
      SELECT id::text, status
      FROM evaluator_calibration_datasets
      WHERE organization_id = ${organizationId}::uuid AND id = ${datasetId}::uuid
      LIMIT 1
    `;
    if (!datasets[0]) throw new NotFoundException("Calibration dataset not found");

    const rows = await this.database.sql`
      SELECT r.id::text AS run_id, r.criterion_comparisons, r.coverage_rate,
             c.rubric_version_id::text, rc.criterion_key, rc.weight
      FROM evaluator_calibration_runs r
      JOIN evaluator_calibration_cases c
        ON c.organization_id = r.organization_id AND c.id = r.calibration_case_id
      JOIN rubric_criteria rc
        ON rc.organization_id = c.organization_id AND rc.rubric_version_id = c.rubric_version_id
      WHERE r.organization_id = ${organizationId}::uuid
        AND c.dataset_id = ${datasetId}::uuid
        AND r.evaluator_version = ${version}
      ORDER BY r.created_at, r.id, rc.display_order, rc.criterion_key
    `;

    const runGroups = new Map<string, {
      coverageRate: number;
      comparisons: StoredComparison[];
      weights: Map<string, number>;
    }>();
    for (const row of rows) {
      const runId = String(row.run_id);
      let group = runGroups.get(runId);
      if (!group) {
        group = {
          coverageRate: Number(row.coverage_rate ?? 0),
          comparisons: asComparisons(row.criterion_comparisons),
          weights: new Map<string, number>(),
        };
        runGroups.set(runId, group);
      }
      group.weights.set(String(row.criterion_key), Number(row.weight));
    }

    const rankingPairs: CalibrationRankingPair[] = [];
    const confidenceObservations: CalibrationConfidenceObservation[] = [];
    const absoluteDeltas: number[] = [];
    let rankingExcludedIncompleteRuns = 0;

    for (const group of runGroups.values()) {
      for (const comparison of group.comparisons) {
        absoluteDeltas.push(comparison.absoluteDelta);
        if (comparison.aiConfidence !== null) {
          confidenceObservations.push({
            confidence: comparison.aiConfidence,
            withinTolerance: comparison.withinTolerance,
          });
        }
      }
      if (group.coverageRate !== 1) {
        rankingExcludedIncompleteRuns += 1;
        continue;
      }
      let totalWeight = 0;
      let humanWeighted = 0;
      let aiWeighted = 0;
      let complete = true;
      for (const comparison of group.comparisons) {
        const weight = group.weights.get(comparison.criterionKey);
        if (!weight || comparison.aiScore === null) {
          complete = false;
          break;
        }
        totalWeight += weight;
        humanWeighted += comparison.referenceScore * weight;
        aiWeighted += comparison.aiScore * weight;
      }
      if (!complete || totalWeight <= 0) {
        rankingExcludedIncompleteRuns += 1;
        continue;
      }
      rankingPairs.push({
        humanScore: Math.round((humanWeighted / totalWeight) * 100) / 100,
        aiScore: Math.round((aiWeighted / totalWeight) * 100) / 100,
      });
    }

    const ranking = calculateRankingAgreement(rankingPairs);
    const confidenceCalibration = buildConfidenceCalibration(confidenceObservations);
    const overallAbsoluteDeltas = rankingPairs.map((pair) => Math.abs(pair.aiScore - pair.humanScore));

    return {
      datasetId,
      evaluatorVersion: version,
      datasetStatus: String(datasets[0].status),
      runCount: runGroups.size,
      ranking: {
        ...ranking,
        excludedIncompleteRunCount: rankingExcludedIncompleteRuns,
        meanAbsoluteOverallScoreDelta: overallAbsoluteDeltas.length
          ? Math.round(
              (overallAbsoluteDeltas.reduce((sum, value) => sum + value, 0) / overallAbsoluteDeltas.length) * 10000,
            ) / 10000
          : null,
      },
      scoreDeltaDistribution: {
        sampleCount: absoluteDeltas.length,
        p50: percentile(absoluteDeltas, 0.5),
        p90: percentile(absoluteDeltas, 0.9),
        p95: percentile(absoluteDeltas, 0.95),
        max: absoluteDeltas.length ? Math.max(...absoluteDeltas) : null,
      },
      confidenceCalibration,
      interpretation: {
        rankingCorrelationMeaningfulFromSampleCount: 2,
        confidenceCalibrationRequiresObservedHumanReference: true,
        incompleteRunsExcludedFromRanking: true,
        finalHiringAuthority: "human",
      },
    };
  }
}

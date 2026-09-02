export interface CalibrationRankingPair {
  humanScore: number;
  aiScore: number;
}

export interface CalibrationConfidenceObservation {
  confidence: number;
  withinTolerance: boolean;
}

export interface CalibrationConfidenceBucket {
  lowerBound: number;
  upperBound: number;
  sampleCount: number;
  meanConfidence: number;
  observedWithinToleranceRate: number;
  calibrationGap: number;
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function validateUnit(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be between 0 and 1`);
  }
}

function validateScore(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${label} must be between 0 and 100`);
  }
}

function pearson(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 2) return null;
  const meanX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const meanY = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  let numerator = 0;
  let varianceX = 0;
  let varianceY = 0;
  for (let index = 0; index < xs.length; index += 1) {
    const dx = xs[index]! - meanX;
    const dy = ys[index]! - meanY;
    numerator += dx * dy;
    varianceX += dx * dx;
    varianceY += dy * dy;
  }
  const denominator = Math.sqrt(varianceX * varianceY);
  return denominator === 0 ? null : round(numerator / denominator);
}

function averageRanks(values: number[]): number[] {
  const sorted = values
    .map((value, index) => ({ value, index }))
    .sort((left, right) => left.value - right.value || left.index - right.index);
  const ranks = new Array<number>(values.length);
  let cursor = 0;
  while (cursor < sorted.length) {
    let end = cursor + 1;
    while (end < sorted.length && sorted[end]!.value === sorted[cursor]!.value) end += 1;
    const averageRank = ((cursor + 1) + end) / 2;
    for (let index = cursor; index < end; index += 1) ranks[sorted[index]!.index] = averageRank;
    cursor = end;
  }
  return ranks;
}

export function calculateRankingAgreement(pairs: CalibrationRankingPair[]) {
  for (const [index, pair] of pairs.entries()) {
    validateScore(pair.humanScore, `pairs[${index}].humanScore`);
    validateScore(pair.aiScore, `pairs[${index}].aiScore`);
  }
  const humanScores = pairs.map((pair) => pair.humanScore);
  const aiScores = pairs.map((pair) => pair.aiScore);
  return {
    sampleCount: pairs.length,
    pearsonScoreCorrelation: pearson(humanScores, aiScores),
    spearmanRankingCorrelation:
      pairs.length < 2 ? null : pearson(averageRanks(humanScores), averageRanks(aiScores)),
  };
}

export function buildConfidenceCalibration(
  observations: CalibrationConfidenceObservation[],
  bucketWidth = 0.2,
) {
  if (!Number.isFinite(bucketWidth) || bucketWidth <= 0 || bucketWidth > 1) {
    throw new Error("bucketWidth must be greater than 0 and at most 1");
  }
  for (const [index, observation] of observations.entries()) {
    validateUnit(observation.confidence, `observations[${index}].confidence`);
  }
  const buckets = new Map<number, CalibrationConfidenceObservation[]>();
  for (const observation of observations) {
    const bucketIndex = Math.min(
      Math.ceil(1 / bucketWidth) - 1,
      Math.floor(observation.confidence / bucketWidth),
    );
    const items = buckets.get(bucketIndex) ?? [];
    items.push(observation);
    buckets.set(bucketIndex, items);
  }
  const result: CalibrationConfidenceBucket[] = [...buckets.entries()]
    .sort(([left], [right]) => left - right)
    .map(([bucketIndex, items]) => {
      const lowerBound = bucketIndex * bucketWidth;
      const upperBound = Math.min(1, lowerBound + bucketWidth);
      const meanConfidence = items.reduce((sum, item) => sum + item.confidence, 0) / items.length;
      const observedWithinToleranceRate =
        items.filter((item) => item.withinTolerance).length / items.length;
      return {
        lowerBound: round(lowerBound),
        upperBound: round(upperBound),
        sampleCount: items.length,
        meanConfidence: round(meanConfidence),
        observedWithinToleranceRate: round(observedWithinToleranceRate),
        calibrationGap: round(Math.abs(meanConfidence - observedWithinToleranceRate)),
      };
    });
  const expectedCalibrationError = observations.length
    ? result.reduce(
        (sum, bucket) => sum + (bucket.sampleCount / observations.length) * bucket.calibrationGap,
        0,
      )
    : null;
  return {
    sampleCount: observations.length,
    bucketWidth: round(bucketWidth),
    expectedCalibrationError:
      expectedCalibrationError === null ? null : round(expectedCalibrationError),
    buckets: result,
  };
}

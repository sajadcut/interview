export function integerEnvironment(value, fallback, min, max) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

export function booleanEnvironment(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`Invalid boolean value: ${value}`);
}

export function percentile(sortedValues, fraction) {
  if (!sortedValues.length) return 0;
  const clamped = Math.max(0, Math.min(1, fraction));
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(clamped * sortedValues.length) - 1));
  return sortedValues[index];
}

export function summarizeLatencies(latencies) {
  const sorted = [...latencies].sort((a, b) => a - b);
  const rounded = (value) => Number(value.toFixed(2));
  return {
    p50: rounded(percentile(sorted, 0.5)),
    p95: rounded(percentile(sorted, 0.95)),
    p99: rounded(percentile(sorted, 0.99)),
    max: rounded(sorted.at(-1) ?? 0),
  };
}

export function scenarioThresholdFailures(result, thresholds) {
  const failures = [];
  if (result.errorRate > thresholds.maxErrorRate) {
    failures.push(
      `errorRate ${(result.errorRate * 100).toFixed(2)}% > ${(thresholds.maxErrorRate * 100).toFixed(2)}%`,
    );
  }
  if (result.latencyMs.p95 > thresholds.p95MaxMs) {
    failures.push(`p95 ${result.latencyMs.p95.toFixed(2)}ms > ${thresholds.p95MaxMs}ms`);
  }
  return failures;
}

export function collectResponseCookies(headers) {
  const values = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : headers.get("set-cookie")
      ? [headers.get("set-cookie")]
      : [];
  return values
    .filter(Boolean)
    .map((value) => String(value).split(";", 1)[0]?.trim())
    .filter(Boolean)
    .join("; ");
}

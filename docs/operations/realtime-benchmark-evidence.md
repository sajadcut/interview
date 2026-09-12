# Realtime benchmark evidence

This harness turns a real staging benchmark window into machine-readable, privacy-bounded evidence. It does not generate fake interviews and it never treats turn count as interview count.

## What it proves

The harness pairs three independent inputs:

1. a reviewed benchmark plan scoped to one production release unit;
2. one PII-free JSONL row for every benchmark interview run;
3. before/after snapshots from the real media-worker Prometheus endpoint.

The session rows prove the number and scenario coverage of completed interviews. Prometheus deltas prove that realtime turns, Whisper processing and reconnect telemetry were actually observed in the same benchmark window. A counter reset between snapshots invalidates the evidence rather than silently calculating misleading negative/partial deltas.

## Plan

Copy `ops/staging/realtime-benchmark-plan.example.json` to a deployment-local file. Replace the release-unit placeholders. The committed example deliberately leaves latency/failure thresholds as `null`; this means the sample may be large enough for analysis, but `productionGatePassed` remains `false` until named owners approve explicit thresholds for that release unit.

A valid plan requires at least 100 completed interviews overall and positive minimum coverage for every declared scenario. The example covers Persian, Persian/English technical code switching, English, weak network, reconnect and browser refresh. Add target-specific scenarios before the run when required.

## Session result format

Write one line per benchmark interview to `.local-data/evidence/realtime-benchmark-sessions.jsonl`:

```json
{"schemaVersion":"realtime-benchmark-session.v1","runId":"bench-0001","scenario":"baseline_fa","language":"fa","status":"completed","turnCount":9,"reconnectCount":0,"failureClass":null}
```

Allowed fields are intentionally fixed. Do not put candidate IDs, names, emails, transcript text, resume content, audio paths or free-form notes in this file. Unknown fields are rejected.

`status` is one of `completed`, `failed`, `abandoned`. `failureClass`, when present, is one of `network`, `ice`, `server`, `provider`, `browser`, `unknown`.

## Capture the benchmark window

Run the staging preflight and smoke first. Then capture a clean metrics baseline immediately before benchmark traffic:

```bash
node scripts/realtime-benchmark-evidence.mjs start \
  --env .env.staging.local \
  --baseline .local-data/evidence/realtime-benchmark-baseline.json
```

Execute the benchmark sessions and append one result row per interview. Do not restart/reset the media worker during the measured window unless the scenario explicitly tests a restart and the benchmark is split into separate baseline/evidence windows. Counter resets invalidate a single window by design.

After the final interview:

```bash
node scripts/realtime-benchmark-evidence.mjs finish \
  --env .env.staging.local \
  --baseline .local-data/evidence/realtime-benchmark-baseline.json \
  --plan .local-data/evidence/realtime-benchmark-plan.json \
  --results .local-data/evidence/realtime-benchmark-sessions.jsonl \
  --evidence .local-data/evidence/realtime-benchmark-evidence.json
```

## Evidence semantics

The evidence reports completed/failed/abandoned interviews, per-scenario coverage, total turns/reconnects, observed realtime turn deltas, Whisper samples, and histogram-derived p95 upper bounds. Histogram p95 is reported as the first observed bucket upper bound containing the 95th percentile; it is not presented as a more precise number than the metric buckets support.

`result=sufficient_sample` means minimum count, scenario coverage, non-reset metrics and observed successful realtime turns were present. It does **not** by itself mean Gate F passed.

`productionGatePassed=true` additionally requires every configured threshold to exist and pass. If a threshold is `null`, its check is `info` and production gate approval remains false. This prevents the harness from inventing production thresholds before measurement/review.

## Repository contract validation

```bash
node --check scripts/realtime-benchmark-evidence.mjs
node --test scripts/realtime-benchmark-evidence.test.mjs
```

CI validates only the analyzer logic. Real benchmark evidence must come from the target staging environment and cannot be synthesized by GitHub Actions.

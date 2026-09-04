# AI Recruiter Platform

Production-oriented AI recruiting platform for job definition, sourcing, screening, scheduling, structured AI interviews, assessments, evidence-backed evaluation, analytics, privacy operations, and enterprise controls.

## Development

```bash
npm install
npm run dev
```

## Quality gates

```bash
npm run check
npm run e2e
```

The root quality gate validates migrations, generated contracts, frontend contract usage, LiveKit deployment configuration, Whisper STT integration contract, alerting rules, lint, typecheck, tests, and production builds.

## Realtime stack contracts

The repository prepares the realtime stack before requiring production provider installation:

- LiveKit deployment contract and health wiring
- Whisper STT HTTP contract with timeout/retry/error mapping
- Realtime metrics contract for LiveKit / whisper.cpp / FFmpeg
- Prometheus alerting contract and runbooks

See `docs/operations/` and `contracts/` for the machine-readable and operational contracts.

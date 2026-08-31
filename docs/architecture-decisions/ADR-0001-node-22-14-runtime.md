# ADR-0001 — Node.js 22.14.0 runtime baseline

> Status: APPROVED
> Date: 2026-08-31

## Context

`master.md` v0.4.0 selected Node.js 24 LTS. The active development baseline is now Node.js 22.14.0 with pnpm 11.13.1 and the required Dotin Nexus registry.

## Decision

The effective repository runtime is:

```text
Node.js >=22.14.0 <23
pnpm 11.x
```

The repository enforces this through `package.json`, `.nvmrc`, `pnpm-workspace.yaml` engine strictness, and `scripts/check-workstation.mjs`.

This ADR supersedes only Node.js 24 runtime-version statements in `master.md` v0.4.0. All other architecture decisions remain unchanged. A future master revision should fold this runtime decision into the canonical document.

## Alternatives

- Upgrade the workstation to Node.js 24: not selected for the current path.
- Support both Node.js 22 and 24: deferred until CI validates a runtime matrix.
- Ignore engine mismatch warnings: rejected because the development environment should be deterministic.

## Migration impact

- Local development and T012 CI use Node.js 22.14+ and below 23.
- Any local lockfile must be validated under Node.js 22.14.0 before commit.

## Other impact

No product, data-model, tenant, authorization, storage, AI, privacy, or deployment architecture changes result from this decision.

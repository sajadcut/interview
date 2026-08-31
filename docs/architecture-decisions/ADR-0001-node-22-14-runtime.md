# ADR-0001 — Node.js 22.14.0 runtime baseline

> Status: SUPERSEDED by `ADR-0002-node-25-npm-runtime.md`  
> Date: 2026-08-31

## Historical context

`master.md` v0.4.0 selected Node.js 24 LTS. This ADR temporarily changed the active development baseline to Node.js 22.14.0 with pnpm 11.13.1.

That decision was later replaced after the development workstation moved to Node.js 25.9.0 and npm 11.6.2 and the repository was migrated to npm workspaces.

## Historical decision

```text
Node.js >=22.14.0 <23
pnpm 11.x
```

Do not use this ADR as the current runtime/package-manager contract. See ADR-0002 and the current `master.md` / `projectstate.md`.

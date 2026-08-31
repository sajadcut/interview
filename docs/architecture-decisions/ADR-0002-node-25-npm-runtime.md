# ADR-0002 — Node.js 25.9.0 + npm 11.6.2 runtime baseline

> Status: APPROVED  
> Date: 2026-08-31

## Context

The active workstation now runs:

```text
Node.js v25.9.0
npm 11.6.2
```

The repository previously used pnpm 11 and briefly targeted Node.js 22.14.0. That combination created avoidable workstation drift and exposed a second problem: NestJS CLI/schematics currently depend on an Angular-devkit line whose engine range excludes Node.js 25.

The product/runtime dependency itself is different from the generator toolchain. NestJS 12 application runtime can remain, while CLI/schematics are removed from day-to-day build/dev execution.

## Decision

The effective JavaScript workstation baseline is:

```text
Node.js >=25.9.0 <26
npm >=11.6.2 <12
npm workspaces
Turborepo
Dotin Nexus registry
```

The root `package.json` owns the workspace definitions. `package-lock.json` is the canonical JavaScript dependency lockfile. `pnpm-workspace.yaml` and `pnpm-lock.yaml` are not part of the active architecture.

## NestJS tooling decision

Keep:

```text
@nestjs/common
@nestjs/core
@nestjs/platform-express
@nestjs/swagger
```

Do not require on the Node 25 workstation:

```text
@nestjs/cli
@nestjs/schematics
```

API compilation uses the TypeScript compiler directly. Development watch uses `apps/api/scripts/dev.mjs`, which invokes `npm exec -- tsc --watch` and runs the compiled application with Node.js.

This avoids a hidden dependency on CLI/schematics packages whose current engine requirements exclude Node 25 while retaining the NestJS application framework.

## Workspace dependency decision

npm 11 workspaces use standard semver dependencies between local workspaces. Do not use the `workspace:*` protocol because npm 11.6.x does not reliably accept it.

Example:

```json
{
  "dependencies": {
    "@interview/ui": "0.1.0"
  }
}
```

When the version matches a configured local workspace, npm links the local workspace instead of fetching it as an external package.

## Registry and privacy

All dependency resolution continues through:

```text
https://nexus3.dotin.ir/repository/Dotin-NPM/
```

Registry credentials must never be committed. Scarf installation analytics are disabled through the root `scarfSettings` configuration.

## Migration impact

Developers migrating an existing pnpm checkout must remove the pnpm-created lockfile and `node_modules`, then perform a clean npm install. The first successful npm install generates `package-lock.json`; that file is committed only after the repository quality gate passes.

T012 CI must use Node.js 25.9.x and npm 11.6.x unless a later ADR replaces this decision.

## Product and domain impact

No product, data-model, tenant, authorization, storage, AI, privacy, scoring, sourcing, interview, or deployment boundaries are changed by this runtime/package-manager decision.

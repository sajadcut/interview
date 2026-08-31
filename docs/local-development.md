# Local development

The current development baseline is a laptop with VS Code and directly installed services. Docker, Docker Compose, Kubernetes and MinIO are not required.

## Required now

- Git
- Node.js 24 LTS
- pnpm 11
- PostgreSQL 18.x
- VS Code (preferred)
- Access to the Dotin Nexus npm repository

Run:

```bash
pnpm workstation:check
```

## Required pnpm registry

This repository is intentionally pinned to:

```text
https://nexus3.dotin.ir/repository/Dotin-NPM/
```

The root `.npmrc` is committed so `pnpm install`, `pnpm build`, `pnpm lint`, and all workspace dependency resolution use this Nexus. Do not override the registry to `registry.npmjs.org` during normal development.

Before installing packages, verify both the effective pnpm configuration and Nexus package access:

```bash
pnpm registry:check
```

The repository `.npmrc` also applies conservative retry/timeout and reduced network-concurrency settings to make installs more resilient when the internal Nexus connection is unstable.

If Nexus authentication is required in the developer environment, configure credentials only at the user/machine level or via environment variables. Never commit tokens, passwords, `_auth`, or `_authToken` values to this repository.

## PostgreSQL

Create a local database and role using your preferred PostgreSQL administration tool.

Suggested development values:

```text
host: localhost
port: 5432
database: interview
user: interview
```

Keep the password only in `.env`; never commit it.

Example connection string:

```text
postgresql://interview:CHANGE_ME@localhost:5432/interview
```

## Starting the apps

```bash
pnpm registry:check
pnpm install
pnpm dev:web
pnpm dev:api
```

Or run both through Turborepo:

```bash
pnpm dev
```

## Add services only when needed

- Redis: when ephemeral state/caching/workflow features require it.
- pgvector: when semantic candidate matching begins.
- Python: when AI/media workers begin.
- LiveKit/coturn: when realtime interview development begins.

Local file artifacts are stored under `.local-data/` and are ignored by Git.

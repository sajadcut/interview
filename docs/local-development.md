# Local development

The current development baseline is a laptop with VS Code and directly installed services. Docker, Docker Compose, Kubernetes and MinIO are not required.

## Required now

- Git
- Node.js 24 LTS
- pnpm 11
- PostgreSQL 18.x
- VS Code (preferred)

Run:

```bash
pnpm workstation:check
```

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

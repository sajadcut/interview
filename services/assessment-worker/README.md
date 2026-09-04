# Assessment Worker

`services/assessment-worker` is the isolated code-execution boundary for coding assessments. It is intentionally independent of the web app, AI worker, media worker, LiveKit, FFmpeg, Whisper, STT/TTS and avatar services.

The core API never evaluates candidate source code in-process. It only persists submissions/jobs and exposes a shared-secret internal lease API. This worker claims a job, runs the source inside a locked-down container, reports deterministic test counts/results, and releases the lease.

## Security boundary

There is no direct-process execution fallback. If Docker/Podman or the pre-pulled sandbox image is unavailable, the job fails instead of running candidate code on the worker host.

Each test execution uses:

- `--network none`
- read-only root filesystem
- read-only source mount
- all Linux capabilities dropped
- `no-new-privileges`
- non-root UID/GID `65534:65534`
- bounded memory, CPU and PID count
- bounded stdout/stderr capture
- hard execution timeout plus forced container cleanup
- `--pull never` so candidate execution cannot trigger image downloads

For production, run this service on a dedicated Linux worker host with a rootless container runtime where possible, a restrictive daemon/socket policy, seccomp/AppArmor/SELinux hardening, pre-pulled and digest-pinned runtime images, no cloud instance credentials, no shared application secrets, and no mount of application/database files.

## Supported languages

Initial allowlist:

- JavaScript / Node (`node:24-alpine` by default)
- Python (`python:3.13-alpine` by default)

Override images with `ASSESSMENT_NODE_IMAGE` and `ASSESSMENT_PYTHON_IMAGE`. Production images should be pinned by digest and prepared before enabling the worker.

The assessment `runner_policy` supplies hidden deterministic cases:

```json
{
  "executionTimeoutMs": 5000,
  "memoryLimitMb": 256,
  "maxAttempts": 3,
  "cpuLimit": 1,
  "pidsLimit": 64,
  "testCases": [
    { "name": "basic", "stdin": "2 3\n", "expectedStdout": "5\n" }
  ]
}
```

Hidden expected outputs are sent only through the internal worker lease endpoint; candidate endpoints do not expose `runner_policy`.

## Run locally

The API and worker must share a non-empty local `ASSESSMENT_WORKER_SHARED_SECRET`.

```text
ASSESSMENT_WORKER_SHARED_SECRET=local-only-secret
ASSESSMENT_WORKER_API_URL=http://127.0.0.1:4100
ASSESSMENT_CONTAINER_RUNTIME=docker
```

Pre-pull the allowlisted images yourself, then run:

```text
npm run assessment-worker:dev
```

Unit tests do not require Docker/Podman:

```text
npm run assessment-worker:test
```

Real sandbox smoke tests are deployment validation and must not be claimed solely from unit tests.

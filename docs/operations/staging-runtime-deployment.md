# Production-like staging runtime deployment

This bundle exists to produce real runtime evidence for the interview stack. It is not a production approval record and it must not enable real-candidate autonomous interviewing.

## Source-controlled bundle

- `ops/staging/runtime-manifest.v1.json` lists the required staging components and evidence gates.
- `ops/staging/staging.env.example` is a deliberately non-runnable template. Every `REPLACE_ME` value must be supplied by the deployment secret store or the host-local `.env.staging.local` file.
- `scripts/staging-runtime-preflight.mjs` validates production-mode configuration and readiness without copying credentials into evidence.
- `scripts/staging-runtime-smoke.mjs` requires the Candidate Interview surface to use a ready real LLM path and performs one ephemeral TTS → VAD → Whisper round trip.

The staging environment file and generated evidence directory are local/deployment artifacts and must not be committed.

## Required topology

The first evidence environment must provide PostgreSQL, API/Web, self-hosted LiveKit with TURN/TLS, media worker with a real FFmpeg build and whisper.cpp model, standalone Silero VAD, standalone TTS, and the realtime AI interviewer connected to a real configured LLM provider. TLS termination may be handled by the host ingress/reverse proxy, but all URLs consumed by the production-mode application must use the secure schemes enforced by the preflight.

The committed LiveKit template remains `ops/livekit/livekit.yaml.example`. Render its API key/secret and TURN domain at deployment time; do not commit a populated LiveKit configuration.

## Deployment sequence

1. Provision PostgreSQL and apply the append-only migrations with the normal migration runner.
2. Render LiveKit/TURN configuration from deployment secrets and verify UDP/TCP/TLS firewall paths.
3. Install a pinned FFmpeg build and a selected whisper.cpp binary/model on the media host.
4. Start media, VAD, TTS and realtime AI-interviewer processes under a real supervisor (systemd, container orchestrator, or equivalent) with restart policy and log collection.
5. Start API/Web with `NODE_ENV=production` and `SUPERVISED_PILOT_ENABLED=false`.
6. Run the preflight and preserve its JSON evidence.
7. Run the smoke test and preserve its JSON evidence.

Example commands from the repository root:

```bash
cp ops/staging/staging.env.example .env.staging.local
# Replace every REPLACE_ME only on the deployment host / secret store.
node scripts/check-staging-runtime-bundle.mjs
node scripts/staging-runtime-preflight.mjs --env .env.staging.local
node scripts/staging-runtime-smoke.mjs --env .env.staging.local
```

## Smoke semantics

The smoke test deliberately does more than health checks. It fails if the Candidate Interview health surface falls back to the deterministic interviewer. It then synthesizes a fixed synthetic, non-candidate phrase through the configured TTS worker, keeps the WAV only in memory, verifies speech detection through Silero VAD, and sends the same WAV through the versioned Whisper contract. Evidence stores only timings/counts/provider metadata; it does not store the synthetic audio, transcript text, API keys, or shared secrets.

Passing this smoke proves that the selected staging services can execute one real cross-provider speech path. It does not prove transcript quality, representative latency, TURN-only connectivity, reconnect recovery, concurrency, evaluator calibration, or candidate safety. Those remain later evidence gates.

## Exit condition for this increment

This deployment increment is implementation-complete when the bundle contract and unit tests are green in GitHub Actions. Phase 1 itself remains open until a real staging host produces passing `staging-runtime-preflight.v1` and `staging-runtime-smoke.v1` evidence using actual providers and binaries.

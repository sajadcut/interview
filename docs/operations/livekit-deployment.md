# LiveKit deployment contract

This repository prepares the Interview application for a self-hosted or managed LiveKit endpoint without making LiveKit Server a local-development dependency. A green repository validates configuration parsing, health probing, token issuance and the software adapter; it does **not** prove that a production LiveKit/TURN/RTP deployment exists or satisfies Gate F.

## Application environment

The transport remains off by default:

```dotenv
MEDIA_REALTIME_ENABLED=false
MEDIA_TRANSPORT_PROVIDER=disabled
LIVEKIT_URL=
LIVEKIT_HEALTH_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
LIVEKIT_TOKEN_TTL_SECONDS=300
TURN_URLS=
```

When `MEDIA_TRANSPORT_PROVIDER=livekit`, API startup fails closed unless all of `LIVEKIT_URL`, `LIVEKIT_HEALTH_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` are present. `LIVEKIT_URL` must be WebSocket `ws://` or `wss://`; the health URL must be HTTP(S). Production additionally requires `wss://`, an `https://` health endpoint, and a non-placeholder API secret of at least 32 bytes.

`LIVEKIT_HEALTH_URL` is intentionally explicit. The application does not guess an undocumented LiveKit health path. Point it at an operator-controlled HTTPS ingress/load-balancer endpoint that returns 2xx only while the LiveKit deployment should receive new application traffic.

`MEDIA_REALTIME_ENABLED` is the separate product execution gate. This lets operators deploy and prove the transport while candidate realtime execution remains disabled.

## Internal health contract

`GET /health/livekit` is an internal operational endpoint and is excluded from public OpenAPI.

- transport disabled: HTTP 200 with `status=disabled`;
- LiveKit selected and probe succeeds: HTTP 200 with `status=ready`;
- LiveKit selected and probe fails: HTTP 503 with a bounded reason such as `http_503`, `timeout` or `unreachable`.

The response never returns the API key, API secret, access token or upstream response body. Base `GET /health/ready` remains database-oriented and does not fail merely because optional LiveKit is disabled.

## Software boundary

`LiveKitTransportAdapter` implements the repository's `RealtimeTransportAdapter`. It owns:

- bounded readiness probing using `MEDIA_PROVIDER_TIMEOUT_MS`;
- short-lived LiveKit join-token issuance through the existing dependency-free HS256 token builder;
- safe deployment-status metadata with no credentials;
- the DI token `REALTIME_TRANSPORT_ADAPTER` so transport orchestration can remain provider-neutral.

The current engineering-only media connection endpoint remains subject to the existing preflight, consent, release and synthetic-candidate restrictions. No token is persisted.

## Server template

`ops/livekit/livekit.yaml.example` is a non-secret starting template. Render a real file outside Git from the environment's secret manager. The template follows LiveKit's self-hosting model: signal/API traffic on 7880 behind TLS termination, ICE/TCP on 7881, an ICE/UDP range, optional embedded TURN, and a separate Prometheus port.

LiveKit's current self-hosting documentation lists the default firewall surface as API/WebSocket 7880 behind a load balancer, ICE/TCP 7881, ICE/UDP 50000-60000 (or UDP mux 7882), TURN/UDP 3478 and TURN/TLS 5349. Operators must match the actual rendered configuration, cloud firewall and load balancer rather than blindly opening the example ranges.

Production TLS requires a trusted certificate and a stable domain. TURN should use its own domain/certificate where applicable. LiveKit recommends Redis for production and requires shared Redis for distributed multi-node deployments. The example leaves Redis commented because topology and secret management are deployment-specific.

Official references:

- https://docs.livekit.io/transport/self-hosting/deployment/
- https://docs.livekit.io/transport/self-hosting/ports-firewall/

## Safe rollout

1. Provision DNS, trusted TLS, firewall rules, TURN and the LiveKit API key/secret in the target environment.
2. Render `livekit.yaml` from `ops/livekit/livekit.yaml.example` plus environment-specific Redis/network settings. Do not commit the rendered secret-bearing file.
3. Deploy LiveKit and configure an HTTPS health endpoint at the load-balancer/ingress boundary.
4. Configure the Interview API with `MEDIA_TRANSPORT_PROVIDER=livekit` while keeping `MEDIA_REALTIME_ENABLED=false`.
5. Confirm `GET /health/livekit` returns `status=ready`; verify LiveKit-native metrics and logs independently.
6. Run synthetic room/join/reconnect tests and confirm TURN from restricted networks.
7. Only after transport evidence is acceptable should `MEDIA_REALTIME_ENABLED=true` be considered for a controlled environment.
8. Gate F still requires representative end-to-end observations, including the documented 100+ interview benchmark. Configuration readiness is not latency, packet-loss or reconnect evidence.

## CI contract

`npm run livekit:config:check` verifies that:

- the root env example keeps LiveKit disabled and contains every required variable;
- no example API secret is populated;
- the server template retains the documented signal/ICE/TURN/Prometheus configuration keys;
- this runbook documents the internal health endpoint and production TLS boundary.

The root test/check scripts execute this contract automatically.

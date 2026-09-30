# Outbound HTTPS and corporate certificates

All Node.js server processes (API, Next.js server, AI interviewer and background workers) default to TLS certificate verification. This applies to standard Node TLS HTTP transports including fetch and SDKs. Browsers and Python processes have independent certificate trust.

Preferred fix for internal certificate authorities: export the internal root/intermediate CA as a PEM file and set `NODE_EXTRA_CA_CERTS` to its absolute path BEFORE starting Node:

```powershell
$env:NODE_EXTRA_CA_CERTS = 'D:\\certs\\dotin-ca.pem'
npm run dev:api
```

Keep private certificate files outside the repository. This approach retains server identity validation.

Isolated local development/test only: set `HTTPS_TLS_VERIFY=false` in your uncommitted root `.env` and restart each Node process. This disables certificate verification process-wide (LLM, ATS, email, calendar, and workers) and weakens protection against impersonation. Production rejects this configuration and the inherited `NODE_TLS_REJECT_UNAUTHORIZED=0` override. Set `HTTPS_TLS_VERIFY=true` to restore validation and restart.

Note: the setting applies to the Node.js server, not browser HTTPS or Python workers. A standalone `node --env-file=.env -e ...` diagnostic bypasses the app bootstrap; use `NODE_EXTRA_CA_CERTS` for it or set Node TLS behavior explicitly only for local diagnostics.

Tests: `node --test scripts/worker-tls.test.mjs`.

# Local runtime port and environment

The repository root `.env` is the canonical local-development environment for both `apps/api` and `apps/web`.

Recommended Windows defaults for this workstation:

```env
API_HOST=127.0.0.1
API_PORT=4100
API_INTERNAL_URL=http://127.0.0.1:4100
NEXT_PUBLIC_API_URL=http://127.0.0.1:4100
CORS_ORIGIN=*
```

Port 4000 is intentionally avoided on the validated workstation because another local service owns it. The API binds explicitly to `API_HOST`, while the internal Next.js proxy reads `API_INTERNAL_URL` from the shared root environment. Browser-facing internal application calls use `/api/backend/*`, so the internal web application does not depend on cross-origin browser requests to the API.

After changing root `.env`, restart the full development stack because both API bind configuration and web server environment are startup configuration.

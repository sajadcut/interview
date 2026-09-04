export class ExternalSourceProviderError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ExternalSourceProviderError";
  }
}

interface ExternalSourceHttpOptions {
  timeoutMs: number;
  maxAttempts: number;
  retryBaseMs: number;
}

function bounded(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
}

function options(): ExternalSourceHttpOptions {
  return {
    timeoutMs: bounded(process.env.EXTERNAL_SOURCE_TIMEOUT_MS, 10_000, 1_000, 60_000),
    maxAttempts: bounded(process.env.EXTERNAL_SOURCE_MAX_ATTEMPTS, 3, 1, 5),
    retryBaseMs: bounded(process.env.EXTERNAL_SOURCE_RETRY_BASE_MS, 250, 50, 5_000),
  };
}

function retryable(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function retryAfterMs(response: Response): number | null {
  const raw = response.headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 30_000);
  const date = new Date(raw);
  if (Number.isNaN(date.valueOf())) return null;
  return Math.min(Math.max(date.valueOf() - Date.now(), 0), 30_000);
}

async function pause(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export async function externalSourceFetch(provider: string, url: string, init: RequestInit): Promise<Response> {
  const config = options();
  let lastError: unknown;
  for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(config.timeoutMs) });
      if (response.ok || !retryable(response.status) || attempt === config.maxAttempts) return response;
      await pause(retryAfterMs(response) ?? Math.min(config.retryBaseMs * 2 ** (attempt - 1), 5_000));
    } catch (error) {
      lastError = error;
      if (attempt === config.maxAttempts) break;
      await pause(Math.min(config.retryBaseMs * 2 ** (attempt - 1), 5_000));
    }
  }
  void lastError;
  throw new ExternalSourceProviderError(`${provider} request failed before a response was received`, `${provider.toUpperCase()}_NETWORK_ERROR`, true);
}

export function assertExternalSourceResponse(response: Response, provider: string): void {
  if (response.ok) return;
  throw new ExternalSourceProviderError(
    `${provider} request failed with HTTP ${response.status}`,
    `${provider.toUpperCase()}_HTTP_${response.status}`,
    retryable(response.status),
    response.status,
  );
}
